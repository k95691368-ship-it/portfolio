import { createClient } from '@supabase/supabase-js'
import * as tus from 'tus-js-client'
import { useCallback, useEffect, useRef, useState } from 'react'

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
const RECORDING_WIDTH = 1280
const RECORDING_HEIGHT = 720

class Emitter {
  listeners = new Map()

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(handler)
  }

  removeListener(event, handler) {
    this.listeners.get(event)?.delete(handler)
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) handler(payload)
  }
}

class ParticipantCollection extends Emitter {
  rows = []

  toArray() {
    return [...this.rows]
  }

  replace(rows) {
    const before = new Set(this.rows.map((item) => item.id))
    const after = new Set(rows.map((item) => item.id))
    this.rows = rows
    for (const item of rows) if (!before.has(item.id)) this.emit('participantJoined', item)
    for (const item of before) if (!after.has(item.id)) this.emit('participantLeft', { id: item })
    if (rows.length === 0 && before.size) this.emit('participantsCleared')
  }
}

function safeMeetingError(error) {
  const name = String(error?.name || '')
  const message = String(error?.message || '').toLowerCase()
  if (name === 'NotAllowedError' || message.includes('permission') || message.includes('denied')) {
    return '카메라와 마이크 권한을 허용한 뒤 다시 시도해주세요.'
  }
  if (name === 'NotFoundError' || message.includes('device')) {
    return '사용할 수 있는 카메라 또는 마이크를 찾지 못했습니다.'
  }
  if (message.includes('network') || message.includes('timeout') || message.includes('connect')) {
    return '연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.'
  }
  return '화상 면접 연결을 준비하지 못했습니다.'
}

function mediaConstraints(audioDeviceId, videoDeviceId) {
  return {
    audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
    video: videoDeviceId
      ? { deviceId: { exact: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { width: { ideal: 1280 }, height: { ideal: 720 } },
  }
}

function participantFromPresence(id, presence) {
  return {
    id,
    userId: id,
    customParticipantId: presence.customParticipantId,
    displayName: presence.displayName || '참가자',
    role: presence.role || 'candidate',
  }
}

function preferredRecordingMime() {
  if (typeof MediaRecorder === 'undefined') return ''
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

function drawVideoCover(context, video, x, y, width, height) {
  if (!video?.videoWidth || !video?.videoHeight) return
  const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = (video.videoWidth - sourceWidth) / 2
  const sourceY = (video.videoHeight - sourceHeight) / 2
  context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

async function hashBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function directStorageEndpoint(projectUrl) {
  const url = new URL(projectUrl)
  const projectRef = url.hostname.split('.')[0]
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`
}

function VideoTile({ stream, label, muted = false, outputDeviceId = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.srcObject = stream || null
    if (stream) void video.play().catch(() => {})
  }, [stream])

  useEffect(() => {
    const video = ref.current
    if (!muted && outputDeviceId && typeof video?.setSinkId === 'function') {
      void video.setSinkId(outputDeviceId).catch(() => {})
    }
  }, [muted, outputDeviceId])

  const hasVideo = Boolean(stream?.getVideoTracks().some((track) => track.enabled))
  return (
    <article className={`webrtc-video-tile${hasVideo ? '' : ' is-camera-off'}`}>
      <video ref={ref} autoPlay playsInline muted={muted} />
      {!hasVideo && <span className="webrtc-video-avatar" aria-hidden="true">{label.slice(0, 1)}</span>}
      <strong>{label}</strong>
    </article>
  )
}

function createCompositeRecording(getSources) {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('이 브라우저에서는 면접 녹화를 지원하지 않습니다.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = RECORDING_WIDTH
  canvas.height = RECORDING_HEIGHT
  const context = canvas.getContext('2d')
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) {
    throw new Error('이 브라우저에서는 면접 음성 녹화를 지원하지 않습니다.')
  }
  const audioContext = new AudioContextClass()
  const destination = audioContext.createMediaStreamDestination()
  const media = new Map()
  let animationFrame = 0

  const ensureMedia = (source) => {
    const streamId = source.stream.id
    if (media.has(streamId)) return media.get(streamId)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = source.stream
    void video.play().catch(() => {})
    const audioTracks = source.stream.getAudioTracks()
    let audioNode = null
    if (audioTracks.length) {
      audioNode = audioContext.createMediaStreamSource(new MediaStream(audioTracks))
      audioNode.connect(destination)
    }
    const entry = { video, audioNode }
    media.set(streamId, entry)
    return entry
  }

  const draw = () => {
    const sources = getSources().filter((source) => source.stream?.active)
    const activeIds = new Set(sources.map((source) => source.stream.id))
    for (const [id, entry] of media) {
      if (activeIds.has(id)) continue
      entry.audioNode?.disconnect()
      entry.video.srcObject = null
      media.delete(id)
    }
    context.fillStyle = '#050505'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const count = Math.max(1, sources.length)
    const columns = count === 1 ? 1 : 2
    const rows = Math.ceil(count / columns)
    const gap = 10
    const tileWidth = (canvas.width - gap * (columns + 1)) / columns
    const tileHeight = (canvas.height - gap * (rows + 1)) / rows
    sources.forEach((source, index) => {
      const x = gap + (index % columns) * (tileWidth + gap)
      const y = gap + Math.floor(index / columns) * (tileHeight + gap)
      context.fillStyle = '#18181a'
      context.fillRect(x, y, tileWidth, tileHeight)
      const entry = ensureMedia(source)
      drawVideoCover(context, entry.video, x, y, tileWidth, tileHeight)
      context.fillStyle = 'rgba(0, 0, 0, .68)'
      context.fillRect(x + 14, y + tileHeight - 48, Math.min(tileWidth - 28, 220), 32)
      context.fillStyle = '#fff'
      context.font = '600 18px system-ui, sans-serif'
      context.fillText(source.label, x + 24, y + tileHeight - 26, Math.min(tileWidth - 48, 196))
    })
    animationFrame = requestAnimationFrame(draw)
  }

  const canvasStream = canvas.captureStream(24)
  const output = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ])
  const mimeType = preferredRecordingMime()
  const recorder = new MediaRecorder(output, mimeType ? { mimeType } : undefined)
  const chunks = []
  const startedAt = Date.now()
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data)
  }
  draw()
  recorder.start(1000)

  return {
    pause() {
      if (recorder.state === 'recording') recorder.pause()
    },
    resume() {
      if (recorder.state === 'paused') recorder.resume()
    },
    stop() {
      return new Promise((resolve, reject) => {
        recorder.onerror = () => reject(new Error('녹화 파일을 만들지 못했습니다.'))
        recorder.onstop = async () => {
          cancelAnimationFrame(animationFrame)
          for (const entry of media.values()) {
            entry.audioNode?.disconnect()
            entry.video.srcObject = null
          }
          output.getTracks().forEach((track) => track.stop())
          await audioContext.close().catch(() => {})
          const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
          resolve({
            blob,
            sha256: await hashBlob(blob),
            sizeBytes: blob.size,
            durationSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
          })
        }
        if (recorder.state === 'inactive') reject(new Error('진행 중인 녹화가 없습니다.'))
        else recorder.stop()
      })
    },
  }
}

export default function RealtimeInterview({
  credentials,
  onConnectionState,
  onMeetingChange,
  onJoinedChange,
}) {
  const [phase, setPhase] = useState('prejoin')
  const [error, setError] = useState('')
  const [localStream, setLocalStream] = useState(null)
  const [remoteParticipants, setRemoteParticipants] = useState([])
  const [devices, setDevices] = useState({ microphones: [], cameras: [], speakers: [] })
  const [audioDeviceId, setAudioDeviceId] = useState('')
  const [videoDeviceId, setVideoDeviceId] = useState('')
  const [outputDeviceId, setOutputDeviceId] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [huddleActive, setHuddleActive] = useState(false)
  const localStreamRef = useRef(null)
  const remoteRef = useRef([])
  const channelRef = useRef(null)
  const supabaseRef = useRef(null)
  const peersRef = useRef(new Map())
  const meetingRef = useRef(null)
  const recordingRef = useRef(null)
  const cameraTrackRef = useRef(null)
  const micOnRef = useRef(true)
  const huddleRef = useRef(false)

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const rows = await navigator.mediaDevices.enumerateDevices()
    setDevices({
      microphones: rows.filter((item) => item.kind === 'audioinput'),
      cameras: rows.filter((item) => item.kind === 'videoinput'),
      speakers: rows.filter((item) => item.kind === 'audiooutput'),
    })
  }, [])

  const updateRemoteParticipants = useCallback(() => {
    const rows = [...peersRef.current.values()]
      .filter((peer) => peer.stream)
      .map((peer) => ({ ...peer.participant, stream: peer.stream }))
    remoteRef.current = rows
    setRemoteParticipants(rows)
  }, [])

  const sendBroadcast = useCallback(async (event, payload) => {
    const channel = channelRef.current
    if (!channel) throw new Error('화상 면접 연결이 끊겼습니다.')
    const result = await channel.send({ type: 'broadcast', event, payload })
    if (result !== 'ok') throw new Error('화상 면접 신호를 보내지 못했습니다.')
  }, [])

  const shouldSeparateAudio = useCallback((remoteRole) => {
    if (!huddleRef.current) return false
    const localStaff = ['host', 'interviewer'].includes(credentials.role)
    const remoteStaff = ['host', 'interviewer'].includes(remoteRole)
    return localStaff !== remoteStaff
  }, [credentials.role])

  const applyOutgoingAudio = useCallback(async () => {
    const track = localStreamRef.current?.getAudioTracks()[0] || null
    await Promise.all(
      [...peersRef.current.values()].map((peer) =>
        peer.audioSender?.replaceTrack(
          micOnRef.current && !shouldSeparateAudio(peer.participant.role) ? track : null
        ).catch(() => {})
      )
    )
  }, [shouldSeparateAudio])

  const removePeer = useCallback((participantId) => {
    const peer = peersRef.current.get(participantId)
    if (!peer) return
    peer.dataChannel?.close()
    peer.connection.close()
    peersRef.current.delete(participantId)
    updateRemoteParticipants()
  }, [updateRemoteParticipants])

  const attachDataChannel = useCallback((peer, dataChannel) => {
    peer.dataChannel = dataChannel
    dataChannel.onmessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message?.type !== 'private-chat' || typeof message.message !== 'string') return
      const chat = meetingRef.current?.chat
      if (!chat) return
      chat.messages.push({
        ...message,
        id: message.id || crypto.randomUUID(),
        type: 'text',
        targetUserIds: [meetingRef.current.self.id],
        time: new Date(message.time || Date.now()),
      })
      chat._events.emit('chatUpdate')
    }
  }, [])

  const ensurePeer = useCallback((participant) => {
    const existing = peersRef.current.get(participant.id)
    if (existing) {
      existing.participant = participant
      return existing
    }
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer = {
      participant,
      connection,
      stream: null,
      dataChannel: null,
      pendingCandidates: [],
      makingOffer: false,
      audioSender: null,
      videoSender: null,
    }
    for (const track of localStreamRef.current?.getTracks() || []) {
      const sender = connection.addTrack(track, localStreamRef.current)
      if (track.kind === 'audio') peer.audioSender = sender
      if (track.kind === 'video') peer.videoSender = sender
    }
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        void sendBroadcast('signal', {
          from: credentials.participantId,
          to: participant.id,
          candidate,
        }).catch(() => {})
      }
    }
    connection.ontrack = (event) => {
      peer.stream = event.streams[0] || peer.stream || new MediaStream()
      if (!event.streams[0]) peer.stream.addTrack(event.track)
      updateRemoteParticipants()
    }
    connection.ondatachannel = (event) => attachDataChannel(peer, event.channel)
    connection.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(connection.connectionState)) removePeer(participant.id)
    }
    if (credentials.participantId < participant.id) {
      attachDataChannel(peer, connection.createDataChannel('staff-chat', { ordered: true }))
    }
    peersRef.current.set(participant.id, peer)
    void applyOutgoingAudio()
    return peer
  }, [applyOutgoingAudio, attachDataChannel, credentials.participantId, removePeer, sendBroadcast, updateRemoteParticipants])

  const makeOffer = useCallback(async (participant) => {
    const peer = ensurePeer(participant)
    if (peer.makingOffer || peer.connection.signalingState !== 'stable') return
    peer.makingOffer = true
    try {
      const offer = await peer.connection.createOffer()
      await peer.connection.setLocalDescription(offer)
      await sendBroadcast('signal', {
        from: credentials.participantId,
        to: participant.id,
        description: peer.connection.localDescription,
      })
    } finally {
      peer.makingOffer = false
    }
  }, [credentials.participantId, ensurePeer, sendBroadcast])

  const leave = useCallback(async () => {
    const meeting = meetingRef.current
    if (meeting?.self?.roomJoined) {
      meeting.self.roomJoined = false
      meeting.self._events.emit('roomLeft')
    }
    for (const id of [...peersRef.current.keys()]) removePeer(id)
    if (channelRef.current) {
      await channelRef.current.untrack().catch(() => {})
      await channelRef.current.unsubscribe().catch(() => {})
    }
    channelRef.current = null
    if (supabaseRef.current) await supabaseRef.current.removeAllChannels().catch(() => {})
    setPhase('left')
    onJoinedChange?.(false)
    onConnectionState?.('left')
  }, [onConnectionState, onJoinedChange, removePeer])

  useEffect(() => {
    let current = true
    setError('')
    setPhase('prejoin')
    onConnectionState?.('ready')

    const participantCollection = new ParticipantCollection()
    const selfEvents = new Emitter()
    const metaEvents = new Emitter()
    const chatEvents = new Emitter()
    const self = {
      id: credentials.participantId,
      userId: credentials.participantId,
      customParticipantId: credentials.customParticipantId,
      displayName: credentials.displayName,
      role: credentials.role,
      roomJoined: false,
      _events: selfEvents,
      on: selfEvents.on.bind(selfEvents),
      removeListener: selfEvents.removeListener.bind(selfEvents),
    }
    const chat = {
      messages: [],
      maxTextLimit: 2000,
      _events: chatEvents,
      on: chatEvents.on.bind(chatEvents),
      removeListener: chatEvents.removeListener.bind(chatEvents),
      async sendTextMessage(text, peerIds) {
        const message = {
          id: crypto.randomUUID(),
          type: 'text',
          message: String(text).slice(0, 2000),
          userId: self.id,
          peerId: self.id,
          displayName: self.displayName,
          targetUserIds: [...peerIds],
          time: new Date(),
        }
        let sent = 0
        for (const peerId of peerIds) {
          const dataChannel = peersRef.current.get(peerId)?.dataChannel
          if (dataChannel?.readyState !== 'open') continue
          dataChannel.send(JSON.stringify(message))
          sent += 1
        }
        if (!sent) throw new Error('connected_staff_not_found')
        chat.messages.push(message)
        chatEvents.emit('chatUpdate')
      },
    }
    const meeting = {
      self,
      meta: {
        meetingId: credentials.meetingId,
        _events: metaEvents,
        on: metaEvents.on.bind(metaEvents),
        removeListener: metaEvents.removeListener.bind(metaEvents),
      },
      participants: { joined: participantCollection },
      chat,
      async leave() {
        await leave()
      },
      huddle: {
        async enter() {
          huddleRef.current = true
          setHuddleActive(true)
          await sendBroadcast('huddle', { active: true, from: self.id })
          await applyOutgoingAudio()
        },
        async leave() {
          huddleRef.current = false
          setHuddleActive(false)
          await sendBroadcast('huddle', { active: false, from: self.id })
          await applyOutgoingAudio()
        },
      },
      recording: {
        start() {
          if (recordingRef.current) throw new Error('이미 녹화 중입니다.')
          recordingRef.current = createCompositeRecording(() => [
            { stream: localStreamRef.current, label: `${credentials.displayName} (나)` },
            ...remoteRef.current.map((item) => ({ stream: item.stream, label: item.displayName })),
          ].filter((item) => item.stream))
        },
        pause() {
          recordingRef.current?.pause()
        },
        resume() {
          recordingRef.current?.resume()
        },
        async stop() {
          if (!recordingRef.current) throw new Error('진행 중인 녹화가 없습니다.')
          const recorder = recordingRef.current
          recordingRef.current = null
          return recorder.stop()
        },
        upload(result, ticket, onProgress) {
          return new Promise((resolve, reject) => {
            const upload = new tus.Upload(result.blob, {
              endpoint: directStorageEndpoint(credentials.projectUrl),
              retryDelays: [0, 3000, 5000, 10000, 20000],
              chunkSize: 6 * 1024 * 1024,
              uploadDataDuringCreation: true,
              removeFingerprintOnSuccess: true,
              headers: { 'x-signature': ticket.token },
              metadata: {
                bucketName: ticket.bucket,
                objectName: ticket.path,
                contentType: result.blob.type || 'video/webm',
                cacheControl: '3600',
              },
              onProgress(bytesUploaded, bytesTotal) {
                onProgress?.(bytesTotal ? bytesUploaded / bytesTotal : 0)
              },
              onError: reject,
              onSuccess: resolve,
            })
            void upload.findPreviousUploads().then((previous) => {
              if (previous.length) upload.resumeFromPreviousUpload(previous[0])
              upload.start()
            }).catch(reject)
          })
        },
      },
    }
    meetingRef.current = meeting
    onMeetingChange?.(meeting)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저에서는 카메라와 마이크를 사용할 수 없습니다.')
      return () => {
        current = false
        meetingRef.current = null
        onMeetingChange?.(null)
      }
    }

    void navigator.mediaDevices
      .getUserMedia(mediaConstraints(audioDeviceId, videoDeviceId))
      .then(async (stream) => {
        if (!current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        localStreamRef.current = stream
        cameraTrackRef.current = stream.getVideoTracks()[0] || null
        setLocalStream(stream)
        await refreshDevices()
      })
      .catch((caught) => {
        if (current) setError(safeMeetingError(caught))
      })

    return () => {
      current = false
      void leave()
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
      meetingRef.current = null
      onMeetingChange?.(null)
    }
    // 장치 선택 변경은 별도 교체 함수에서 처리한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials.authToken])

  const syncPresence = useCallback(async () => {
    const channel = channelRef.current
    const meeting = meetingRef.current
    if (!channel || !meeting) return
    const state = channel.presenceState()
    const participants = []
    for (const [id, entries] of Object.entries(state)) {
      if (id === credentials.participantId) continue
      const presence = entries.at(-1)
      if (!presence) continue
      const participant = participantFromPresence(id, presence)
      participants.push(participant)
      ensurePeer(participant)
      if (credentials.participantId < id) void makeOffer(participant).catch(() => {})
    }
    const active = new Set(participants.map((item) => item.id))
    for (const id of peersRef.current.keys()) if (!active.has(id)) removePeer(id)
    meeting.participants.joined.replace(participants)
  }, [credentials.participantId, ensurePeer, makeOffer, removePeer])

  const join = useCallback(async () => {
    if (!localStreamRef.current || phase === 'joining') return
    setPhase('joining')
    setError('')
    onConnectionState?.('connecting')
    const supabase = createClient(credentials.projectUrl, credentials.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const channel = supabase.channel(`interview:${credentials.meetingId}`, {
      config: { presence: { key: credentials.participantId }, broadcast: { self: false } },
    })
    supabaseRef.current = supabase
    channelRef.current = channel
    channel
      .on('presence', { event: 'sync' }, () => void syncPresence())
      .on('broadcast', { event: 'signal' }, async ({ payload }) => {
        if (payload?.to !== credentials.participantId || !payload.from) return
        const state = channel.presenceState()
        const presence = state[payload.from]?.at(-1) || {}
        const participant = participantFromPresence(payload.from, presence)
        const peer = ensurePeer(participant)
        try {
          if (payload.description) {
            await peer.connection.setRemoteDescription(payload.description)
            for (const candidate of peer.pendingCandidates.splice(0)) {
              await peer.connection.addIceCandidate(candidate)
            }
            if (payload.description.type === 'offer') {
              const answer = await peer.connection.createAnswer()
              await peer.connection.setLocalDescription(answer)
              await sendBroadcast('signal', {
                from: credentials.participantId,
                to: payload.from,
                description: peer.connection.localDescription,
              })
            }
          } else if (payload.candidate) {
            if (peer.connection.remoteDescription) {
              await peer.connection.addIceCandidate(payload.candidate)
            } else {
              peer.pendingCandidates.push(payload.candidate)
            }
          }
        } catch {
          removePeer(payload.from)
        }
      })
      .on('broadcast', { event: 'huddle' }, ({ payload }) => {
        huddleRef.current = payload?.active === true
        setHuddleActive(huddleRef.current)
        void applyOutgoingAudio()
      })
      .on('broadcast', { event: 'control' }, ({ payload }) => {
        if (payload?.event === 'meeting-ended' || payload?.event === 'all-participants-kicked') {
          void leave()
        }
        if (
          payload?.event === 'participants-kicked' &&
          payload.customParticipantIds?.includes(credentials.customParticipantId)
        ) {
          void leave()
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            participantId: credentials.participantId,
            customParticipantId: credentials.customParticipantId,
            displayName: credentials.displayName,
            role: credentials.role,
            onlineAt: new Date().toISOString(),
          })
          const meeting = meetingRef.current
          if (meeting) {
            meeting.self.roomJoined = true
            meeting.self._events.emit('roomJoined')
            meeting.meta._events?.emit?.('socketConnectionUpdate', 'connected')
          }
          setPhase('joined')
          onJoinedChange?.(true)
          onConnectionState?.('connected')
          void syncPresence()
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
          onConnectionState?.('reconnecting')
        } else if (status === 'CLOSED') {
          onConnectionState?.('left')
        }
      })
  }, [applyOutgoingAudio, credentials, ensurePeer, leave, onConnectionState, onJoinedChange, phase, removePeer, sendBroadcast, syncPresence])

  const replaceDevice = async (kind, deviceId) => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio'
          ? { audio: { deviceId: { exact: deviceId } }, video: false }
          : { audio: false, video: { deviceId: { exact: deviceId } } }
      )
      const nextTrack = stream.getTracks()[0]
      const current = localStreamRef.current
      const oldTrack = kind === 'audio' ? current.getAudioTracks()[0] : current.getVideoTracks()[0]
      if (oldTrack) current.removeTrack(oldTrack)
      current.addTrack(nextTrack)
      oldTrack?.stop()
      if (kind === 'audio') {
        setAudioDeviceId(deviceId)
        nextTrack.enabled = micOnRef.current
        await applyOutgoingAudio()
      } else {
        setVideoDeviceId(deviceId)
        cameraTrackRef.current = nextTrack
        nextTrack.enabled = cameraOn
        await Promise.all([...peersRef.current.values()].map((peer) => peer.videoSender?.replaceTrack(nextTrack)))
      }
      setLocalStream(new MediaStream(current.getTracks()))
    } catch (caught) {
      setError(safeMeetingError(caught))
    }
  }

  const toggleMic = async () => {
    micOnRef.current = !micOnRef.current
    setMicOn(micOnRef.current)
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (track) track.enabled = micOnRef.current
    await applyOutgoingAudio()
  }

  const toggleCamera = () => {
    const next = !cameraOn
    setCameraOn(next)
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (track) track.enabled = next
  }

  const toggleScreen = async () => {
    if (screenSharing) {
      const camera = cameraTrackRef.current
      if (camera) {
        await Promise.all([...peersRef.current.values()].map((peer) => peer.videoSender?.replaceTrack(camera)))
        const audio = localStreamRef.current?.getAudioTracks() || []
        localStreamRef.current = new MediaStream([camera, ...audio])
        setLocalStream(localStreamRef.current)
      }
      setScreenSharing(false)
      return
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const screenTrack = display.getVideoTracks()[0]
      await Promise.all([...peersRef.current.values()].map((peer) => peer.videoSender?.replaceTrack(screenTrack)))
      const audio = localStreamRef.current?.getAudioTracks() || []
      localStreamRef.current = new MediaStream([screenTrack, ...audio])
      setLocalStream(localStreamRef.current)
      setScreenSharing(true)
      screenTrack.onended = () => {
        const camera = cameraTrackRef.current
        if (camera) {
          void Promise.all(
            [...peersRef.current.values()].map((peer) => peer.videoSender?.replaceTrack(camera))
          )
          const currentAudio = localStreamRef.current?.getAudioTracks() || []
          localStreamRef.current = new MediaStream([camera, ...currentAudio])
          setLocalStream(localStreamRef.current)
        }
        setScreenSharing(false)
      }
    } catch (caught) {
      if (caught?.name !== 'NotAllowedError') setError(safeMeetingError(caught))
    }
  }

  if (phase === 'left') {
    return (
      <div className="interview-meeting-failure" role="status">
        <span className="interview-state-symbol" aria-hidden="true">✓</span>
        <h2>화상 면접에서 나왔습니다.</h2>
      </div>
    )
  }

  if (phase === 'prejoin' || phase === 'joining') {
    return (
      <div className="webrtc-prejoin">
        <div className="webrtc-prejoin__preview">
          <VideoTile stream={localStream} label={`${credentials.displayName} (나)`} muted />
        </div>
        <div className="webrtc-prejoin__settings">
          <p className="interview-consent-eyebrow">장치 확인</p>
          <h2>카메라와 마이크를 확인해주세요.</h2>
          <label>
            마이크
            <select value={audioDeviceId} onChange={(event) => void replaceDevice('audio', event.target.value)}>
              {devices.microphones.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || `마이크 ${index + 1}`}</option>
              ))}
            </select>
          </label>
          <label>
            카메라
            <select value={videoDeviceId} onChange={(event) => void replaceDevice('video', event.target.value)}>
              {devices.cameras.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || `카메라 ${index + 1}`}</option>
              ))}
            </select>
          </label>
          <div className="webrtc-prejoin__toggles">
            <button type="button" onClick={() => void toggleMic()}>{micOn ? '마이크 끄기' : '마이크 켜기'}</button>
            <button type="button" onClick={toggleCamera}>{cameraOn ? '카메라 끄기' : '카메라 켜기'}</button>
          </div>
          {error && <p className="interview-inline-error" role="alert">{error}</p>}
          <button
            type="button"
            className="interview-primary-button"
            disabled={!localStream || phase === 'joining'}
            onClick={() => void join()}
          >
            {phase === 'joining' ? '입장하는 중…' : '화상 면접 입장'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`interview-meeting-stage${huddleActive ? ' is-huddle' : ''}`}>
      {huddleActive && <div className="webrtc-huddle-banner">면접관 협의 중</div>}
      <div className="webrtc-video-grid">
        <VideoTile stream={localStream} label={`${credentials.displayName} (나)`} muted />
        {remoteParticipants.map((participant) => (
          <VideoTile
            key={participant.id}
            stream={participant.stream}
            label={participant.displayName}
            outputDeviceId={outputDeviceId}
          />
        ))}
      </div>
      <div className="webrtc-controls" aria-label="화상 면접 제어">
        <button type="button" className={micOn ? '' : 'is-off'} onClick={() => void toggleMic()}>
          {micOn ? '마이크' : '음소거'}
        </button>
        <button type="button" className={cameraOn ? '' : 'is-off'} onClick={toggleCamera}>
          {cameraOn ? '카메라' : '카메라 꺼짐'}
        </button>
        <button type="button" className={screenSharing ? 'is-active' : ''} onClick={() => void toggleScreen()}>
          {screenSharing ? '공유 중지' : '화면 공유'}
        </button>
        <button type="button" onClick={() => setSettingsOpen((value) => !value)}>장치 설정</button>
        <button type="button" className="is-leave" onClick={() => void leave()}>나가기</button>
      </div>
      {settingsOpen && (
        <div className="webrtc-device-panel">
          <label>마이크<select value={audioDeviceId} onChange={(event) => void replaceDevice('audio', event.target.value)}>{devices.microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `마이크 ${index + 1}`}</option>)}</select></label>
          <label>카메라<select value={videoDeviceId} onChange={(event) => void replaceDevice('video', event.target.value)}>{devices.cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `카메라 ${index + 1}`}</option>)}</select></label>
          {devices.speakers.length > 0 && <label>스피커<select value={outputDeviceId} onChange={(event) => setOutputDeviceId(event.target.value)}>{devices.speakers.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `스피커 ${index + 1}`}</option>)}</select></label>}
        </div>
      )}
      {error && <p className="interview-connection-warning" role="alert">{error}</p>}
    </div>
  )
}
