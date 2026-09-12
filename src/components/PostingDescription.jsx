import { parsePostingDescription } from '../../shared/jobPostingTemplate.js'

export default function PostingDescription({ value }) {
  const blocks = parsePostingDescription(value)
  const elements = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type === 'heading') elements.push(<h2 key={i}>{block.text}</h2>)
    else if (block.type === 'subheading') elements.push(<h3 key={i}>{block.text}</h3>)
    else if (block.type === 'item') {
      const items = []
      const key = i
      while (i < blocks.length && blocks[i].type === 'item') {
        items.push(<li key={i}>{blocks[i].text}</li>); i++
      }
      i--
      elements.push(<ul key={key}>{items}</ul>)
    } else elements.push(<p key={i}>{block.text}</p>)
  }
  return <div className="posting-description">{elements}</div>
}
