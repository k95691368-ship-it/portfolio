export const HUDDLE_TITLE = '면접관 협의실'
export const HUDDLE_WORKFLOW_STORAGE_VERSION = 1

const STAFF_ROLES = new Set(['host', 'interviewer'])

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function huddleWorkflowStorageKey(sessionId) {
  return `interview-huddle:${String(sessionId ?? '')}`
}

export function normalizeHuddleWorkflow(value) {
  if (!value || value.version !== HUDDLE_WORKFLOW_STORAGE_VERSION) return null
  if (typeof value.parentId !== 'string' || typeof value.huddleId !== 'string') return null
  if (!value.parentId || !value.huddleId || value.parentId === value.huddleId) return null
  const stringList = (items) =>
    Array.isArray(items)
      ? unique(items.filter((item) => typeof item === 'string' && item))
      : []
  return {
    parentId: value.parentId,
    huddleId: value.huddleId,
    staffCustomIds: stringList(value.staffCustomIds),
    candidateCustomIds: stringList(value.candidateCustomIds),
    shouldResume: value.shouldResume === true,
    recordingId:
      typeof value.recordingId === 'string' && value.recordingId
        ? value.recordingId
        : null,
  }
}

export function isInterviewStaff(role) {
  return STAFF_ROLES.has(String(role ?? '').toLowerCase())
}

export function staffCustomParticipantIds(members = []) {
  return unique(
    members
      .filter((member) => isInterviewStaff(member?.role))
      .map((member) => member?.customParticipantId)
  )
}

export function candidateCustomParticipantIds(members = []) {
  return unique(
    members
      .filter((member) => String(member?.role ?? '').toLowerCase() === 'candidate')
      .map((member) => member?.customParticipantId)
  )
}

export function participantMovePlan(members = [], connectedParticipants = []) {
  const allowed = new Set(staffCustomParticipantIds(members))
  const selected = connectedParticipants.filter(
    (participant) =>
      participant?.id &&
      participant?.customParticipantId &&
      allowed.has(participant.customParticipantId)
  )
  return {
    participantIds: unique(selected.map((participant) => participant.id)),
    customParticipantIds: unique(
      selected.map((participant) => participant.customParticipantId)
    ),
  }
}

export function privateMessagePeerIds(members = [], joinedParticipants = [], self = null) {
  const allowed = new Set(staffCustomParticipantIds(members))
  return unique(
    joinedParticipants
      .filter(
        (participant) =>
          participant?.id &&
          participant?.customParticipantId &&
          allowed.has(participant.customParticipantId) &&
          participant.customParticipantId !== self?.customParticipantId &&
          participant.id !== self?.id
      )
      .map((participant) => participant.id)
  )
}

export function privateMessageSenderIds(members = [], joinedParticipants = [], self = null) {
  const allowedCustomIds = new Set(staffCustomParticipantIds(members))
  const matched = joinedParticipants.filter(
    (participant) =>
      participant?.customParticipantId &&
      allowedCustomIds.has(participant.customParticipantId)
  )
  if (self?.customParticipantId && allowedCustomIds.has(self.customParticipantId)) {
    matched.push(self)
  }
  return unique(
    matched.flatMap((participant) => [
      participant?.id,
      participant?.userId,
      participant?.customParticipantId,
    ])
  )
}

export function meetingEntry(snapshot, meetingId) {
  if (!snapshot || !meetingId) return null
  if (snapshot.parentMeeting?.id === meetingId) return snapshot.parentMeeting
  return snapshot.meetings?.find((item) => item?.id === meetingId) ?? null
}

export function findHuddleMeeting(snapshot) {
  return snapshot?.meetings?.find((item) => item?.title === HUDDLE_TITLE) ?? null
}

export function placementConfirmed(
  snapshot,
  meetingId,
  requiredCustomIds = [],
  forbiddenCustomIds = []
) {
  const target = meetingEntry(snapshot, meetingId)
  if (!target) return false
  const placed = new Set(
    (target.participants ?? []).map((participant) => participant?.customParticipantId).filter(Boolean)
  )
  return (
    requiredCustomIds.every((id) => placed.has(id)) &&
    forbiddenCustomIds.every((id) => !placed.has(id))
  )
}

export function huddleTransitionConfirmed(
  snapshot,
  currentMeetingId,
  huddleId,
  staffCustomIds = [],
  candidateCustomIds = []
) {
  return Boolean(
    currentMeetingId === huddleId &&
      placementConfirmed(snapshot, huddleId, staffCustomIds, candidateCustomIds)
  )
}

export function parentReturnConfirmed(
  snapshot,
  currentMeetingId,
  parentId,
  requiredCustomIds = []
) {
  return Boolean(
    currentMeetingId === parentId &&
      placementConfirmed(snapshot, parentId, requiredCustomIds, [])
  )
}

export function activeParticipantsReturnedToParent(
  snapshot,
  currentMeetingId,
  parentId,
  trackedCustomIds = []
) {
  if (currentMeetingId !== parentId) return false
  const parent = meetingEntry(snapshot, parentId)
  if (!parent) return false

  const tracked = new Set(trackedCustomIds.filter(Boolean))
  if (tracked.size === 0) return true
  const stillInAnotherMeeting = (snapshot.meetings ?? []).some(
    (entry) =>
      entry?.id !== parentId &&
      (entry?.participants ?? []).some((participant) => {
        const customId = participant?.customParticipantId
        return customId && tracked.has(customId)
      })
  )

  // A participant who left the call is absent from every connected meeting and
  // must not keep the recording paused forever. Any tracked participant who is
  // still connected outside the parent meeting continues to block the resume.
  return !stillInAnotherMeeting
}

export function privateTextMessages(messages = [], allowedSenderIds = []) {
  const allowedSenders = new Set(allowedSenderIds)
  return messages
    .filter(
      (message) =>
        message?.type === 'text' &&
        typeof message.message === 'string' &&
        Array.isArray(message.targetUserIds) &&
        message.targetUserIds.length > 0 &&
        (allowedSenders.has(message.userId) || allowedSenders.has(message.peerId))
    )
    .map((message) => ({
      id: String(message.id),
      body: message.message,
      senderName: message.displayName || '면접관',
      senderId: message.userId ?? null,
      createdAt:
        message.time instanceof Date
          ? message.time.toISOString()
          : message.time ?? new Date(0).toISOString(),
    }))
}

export function huddleLocksRecordingControls(phase) {
  return String(phase ?? 'parent') !== 'parent'
}

export function publicChatParticipants(members = []) {
  return members
    .filter((member) => member?.userId)
    .map((member) => ({
      id: member.userId,
      displayName: member.displayName,
      role: String(member.role).toLowerCase() === 'candidate' ? 'candidate' : 'company',
    }))
}

export function recordingMediaState(status) {
  const value = String(status ?? 'idle').toLowerCase()
  if (value === 'recording') return 'must-pause'
  if (value === 'paused') return 'already-paused'
  if (['starting', 'resuming', 'stopping', 'processing'].includes(value)) return 'transitioning'
  return 'inactive'
}

export async function waitForConfirmedState(check, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000
  const intervalMs = options.intervalMs ?? 400
  const startedAt = Date.now()
  let lastError = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await check()) return true
      lastError = null
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  if (lastError) throw lastError
  return false
}
