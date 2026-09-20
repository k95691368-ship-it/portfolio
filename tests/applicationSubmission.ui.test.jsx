import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const host = vi.hoisted(() => ({ cells: [], index: 0, effects: [], dirty: false }))
vi.mock('react', async original => ({ ...await original(),
  useState(initial) { const i=host.index++; const cell=host.cells[i] ||= {value:typeof initial==='function'?initial():initial}; return [cell.value,value=>{cell.value=typeof value==='function'?value(cell.value):value;host.dirty=true}] },
  useRef(value) { return host.cells[host.index++] ||= {current:value} },
  useMemo(create) { host.index++; return create() },
  useEffect(effect,deps) { const i=host.index++; if (!host.cells[i] || deps.some((value,j)=>!Object.is(value,host.cells[i].deps[j]))) { host.cells[i]={deps};host.effects.push(effect) } },
}))
vi.mock('react-router-dom',()=>({Link:'test-link',useParams:()=>({id:'posting'}),useNavigate:()=>vi.fn()}))
vi.mock('../src/api/client.js',()=>({api:{get:vi.fn(),post:vi.fn(),upload:vi.fn()}}))
vi.mock('../src/context/ToastContext.jsx',()=>({useToast:()=>({error:vi.fn(),success:vi.fn()})}))
vi.mock('../src/lib/applicationSelfService.js',()=>({applicationOperation:vi.fn(),restartApplicationOperation:vi.fn()}))
import { api } from '../src/api/client.js'
import { applicationOperation, restartApplicationOperation } from '../src/lib/applicationSelfService.js'
import ApplyPage from '../src/pages/ApplyPage.jsx'
let tree
const walk=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.props?.children)]
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children)
const button=label=>walk(tree).find(node=>node.type==='button'&&text(node).includes(label))
function render() { for(let n=0;n<10;n++){host.index=0;host.effects=[];host.dirty=false;tree=ApplyPage();for(const effect of host.effects)effect();if(!host.dirty)return tree}throw new Error('render loop') }
async function settle(){for(let i=0;i<12;i++)await Promise.resolve();render()}
beforeEach(()=>{
  vi.clearAllMocks();host.cells=[];host.index=0;host.effects=[]
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn(),confirm:vi.fn(()=>true)})
  vi.stubGlobal('sessionStorage',{getItem:vi.fn(()=>null)})
  api.get.mockResolvedValue({posting:{title:'Test role',status:'open'}})
  applicationOperation.mockReturnValue('a'.repeat(64))
})
afterEach(()=>vi.unstubAllGlobals())
it('shows a recovered withdrawal honestly and starts a new operation only on explicit reapplication',async()=>{
  sessionStorage.getItem.mockReturnValue('a'.repeat(64))
  api.post.mockResolvedValue({lookupCode:'OLD2345ABC',status:'withdrawn'})
  render();await settle()
  expect(text(tree)).toContain('철회한 지원 내역입니다')
  expect(text(tree)).not.toContain('지원이 완료되었습니다')
  expect(restartApplicationOperation).not.toHaveBeenCalled()
  button('새 지원서 작성').props.onClick();render()
  expect(restartApplicationOperation).toHaveBeenCalledWith('posting')
  expect(walk(tree).some(node=>node.type==='form')).toBe(true)
  expect(text(tree)).not.toContain('OLD2345ABC')
})
it('recovers a lost upload response using the same persisted operation, without uploading twice',async()=>{
  render();await settle()
  walk(tree).find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[new File(['%PDF-1.4'],'resume.pdf')]}})
  walk(tree).find(node=>node.props?.item?.key==='consentRequired').props.onToggle(true)
  render()
  api.upload.mockRejectedValue(new Error('response lost'))
  api.post.mockResolvedValue({lookupCode:'NEW2345ABC',status:'submitted'})
  await walk(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle()
  expect(api.upload).toHaveBeenCalledOnce()
  expect(api.upload.mock.calls[0][1].get('operationToken')).toBe('a'.repeat(64))
  expect(api.post).toHaveBeenCalledWith('/application-receipt',{postingId:'posting',operationToken:'a'.repeat(64)})
  expect(text(tree)).toContain('NEW2345ABC')
  expect(text(tree)).toContain('지원이 완료되었습니다')
})

it('keeps the same form and selected file when the initial posting lookup fails late, then retries GET only',async()=>{
  let rejectLookup
  api.get.mockReturnValueOnce(new Promise((_,reject)=>{rejectLookup=reject}))
  render()
  const file=new File(['%PDF-1.4'],'preserved-resume.pdf')
  walk(tree).find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[file]}})
  render()
  expect(button('지원서 제출하기').props.disabled).toBe(true)
  rejectLookup(new Error('Synthetic posting lookup failure'));await settle()
  expect(walk(tree).some(node=>node.type==='form')).toBe(true)
  expect(text(tree)).toContain('preserved-resume.pdf')
  expect(text(tree)).toContain('작성 중인 내용은 유지됩니다.')
  await walk(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}})
  expect(api.upload).not.toHaveBeenCalled()
  button('공고 다시 불러오기').props.onClick();render();await settle()
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(text(tree)).toContain('preserved-resume.pdf')
  expect(button('지원서 제출하기').props.disabled).toBe(false)
  expect(api.post).not.toHaveBeenCalled()
})

it('disables submission for a successfully loaded closed posting',async()=>{
  api.get.mockResolvedValueOnce({posting:{title:'Closed role',open:false}})
  render();await settle()
  expect(button('지원서 제출하기').props.disabled).toBe(true)
  expect(text(tree)).toContain('마감된 공고에는 지원할 수 없습니다.')
})
