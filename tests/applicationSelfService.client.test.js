import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const auth = vi.hoisted(() => ({ revision: 0 }))
vi.mock('../src/api/client.js', () => ({ API_BASE: '/api', getAccountAuthRevision: () => auth.revision }))
const storage=()=>{const rows=new Map();return{getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,String(value)),removeItem:key=>rows.delete(key)}}
let service
beforeEach(async()=>{auth.revision=0;vi.resetModules();vi.stubGlobal('sessionStorage',storage());vi.stubGlobal('fetch',vi.fn());service=await import('../src/lib/applicationSelfService.js')})
afterEach(()=>vi.unstubAllGlobals())
it('reuses one unpredictable operation per posting across module reload',async()=>{
  const token=service.applicationOperation('one');expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(service.applicationOperation('two')).not.toBe(token)
  vi.resetModules();expect((await import('../src/lib/applicationSelfService.js')).applicationOperation('one')).toBe(token)
})
it('fails closed when operation storage cannot be saved',()=>{
  sessionStorage.setItem=()=>{throw new Error('denied')}
  expect(()=>service.applicationOperation('one')).toThrow('denied');expect(fetch).not.toHaveBeenCalled()
})
it('sends scoped credentials in a header only and rejects expired access',async()=>{
  sessionStorage.setItem('portfolioApplicationAccess',JSON.stringify({token:'a'.repeat(64),expiresAt:new Date(Date.now()+60_000).toISOString()}))
  fetch.mockResolvedValue(Response.json({applications:[]}));await service.applicationAccess.list()
  expect(fetch.mock.lastCall[0]).not.toContain('a'.repeat(64))
  expect(fetch.mock.lastCall[1].headers['X-Application-Authorization']).toBe('Bearer '+'a'.repeat(64))
  sessionStorage.setItem('portfolioApplicationAccess',JSON.stringify({token:'a'.repeat(64),expiresAt:'2000-01-01'}))
  await expect(service.applicationAccess.list()).rejects.toMatchObject({status:401})
  expect(fetch).toHaveBeenCalledOnce()
})
const proof = () => ({token:'a'.repeat(64),expiresAt:new Date(Date.now()+60_000).toISOString()})
it.each(['logout','end'])('does not install a late exchange response after %s',async action=>{
  let resolve;fetch.mockImplementation(()=>new Promise(done=>{resolve=done}))
  const pending=service.applicationAccess.exchange('b'.repeat(64))
  if(action==='logout')auth.revision++
  else service.clearApplicationAccess()
  resolve(Response.json(proof()))
  await expect(pending).rejects.toMatchObject({code:'STALE_AUTH_RESPONSE'})
  expect(sessionStorage.getItem('portfolioApplicationAccess')).toBeNull()
  expect(service.hasApplicationAccess()).toBe(false)
})
it.each(['list','file'])('discards a late %s response after access ends',async action=>{
  sessionStorage.setItem('portfolioApplicationAccess',JSON.stringify(proof()))
  let resolve;fetch.mockImplementation(()=>new Promise(done=>{resolve=done}))
  const pending=action==='list'?service.applicationAccess.list():service.applicationAccess.file('app','doc')
  service.clearApplicationAccess()
  resolve(action==='list'?Response.json({applications:[{id:'private'}]}):new Response('private bytes'))
  await expect(pending).rejects.toMatchObject({code:'STALE_AUTH_RESPONSE'})
})
it('ends in-memory access even if storage deletion fails and allows an explicit new proof',async()=>{
  sessionStorage.setItem('portfolioApplicationAccess',JSON.stringify(proof()))
  sessionStorage.removeItem=()=>{throw new Error('denied')}
  service.clearApplicationAccess();expect(service.hasApplicationAccess()).toBe(false)
  fetch.mockResolvedValue(Response.json(proof()))
  await service.applicationAccess.exchange('b'.repeat(64));expect(service.hasApplicationAccess()).toBe(true)
})
it('replaces a recovered operation only for an explicit new application',()=>{
  const previous=service.applicationOperation('one')
  const next=service.restartApplicationOperation('one')
  expect(next).not.toBe(previous);expect(service.applicationOperation('one')).toBe(next)
})
