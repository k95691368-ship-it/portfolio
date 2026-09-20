// Offline tests must not send STUN traffic to an external provider.
export async function interviewIceServers() { return { iceServers: [], relayConfigured: false } }
