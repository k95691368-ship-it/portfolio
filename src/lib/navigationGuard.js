export function shouldBlockFormNavigation(when, currentLocation, nextLocation) {
  return Boolean(when && (
    currentLocation.pathname !== nextLocation.pathname ||
    currentLocation.search !== nextLocation.search
  ))
}
