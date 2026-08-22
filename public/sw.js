// 창을 닫아도 알림을 띄우는 조각.
//
// 브라우저가 이 파일을 따로 들고 있다가, 밀어 주는 알림이 오면 페이지가
// 없어도 깨워서 실행한다. 그래서 여기에는 화면 코드를 쓸 수 없다 -- window 도
// document 도 없다.
//
// 캐시는 하지 않는다. 이 파일이 낡으면 알림이 조용히 옛 동작을 하는데,
// 그것은 알림이 안 오는 것보다 알아차리기 어렵다.

self.addEventListener('install', (event) => {
  // 새 조각을 곧바로 쓴다. 기다리면 알림 동작이 다음 방문까지 옛것으로 남는다.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  // 이미 열려 있는 탭들도 이 조각이 맡는다.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || '새 메시지'
  const options = {
    body: data.body || '면접방에 새 메시지가 도착했습니다.',
    // 같은 방의 알림은 같은 자리를 덮어쓴다. 대화가 활발할 때 알림이 쌓이면
    // 정작 무엇을 보라는 것인지 알 수 없다.
    tag: data.tag || 'room-message',
    renotify: true,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // 누르면 어디로 갈지. 알림만 뜨고 갈 곳이 없으면 다시 찾아 들어가야 한다.
    data: { url: data.url || '/' },
    // 자동으로 사라지지 않게 둔다. 자리를 비운 사이 온 알림이 목적이다.
    requireInteraction: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'

  // 이미 열려 있는 창이 있으면 그것을 쓴다. 누를 때마다 새 창이 쌓이면
  // 같은 방이 여러 개 열린다.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate?.(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
