import * as route0 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/upload-ticket.js'
import * as route1 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/complete.js'
import * as route2 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recording/[recordingId]/control.js'
import * as route3 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/retry.js'
import * as route4 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/[recordingId]/file.js'
import * as route5 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recording/start.js'
import * as route6 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/recordings/index.js'
import * as route7 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/members/index.js'
import * as route8 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/join-token.js'
import * as route9 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/signaling.js'
import * as route10 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/consent.js'
import * as route11 from '../../../server/api/admin/users/[id]/reset-password.js'
import * as route12 from '../../../server/api/admin/rooms/[roomId]/messages.js'
import * as route13 from '../../../server/api/admin/contracts/[id]/file.js'
import * as route14 from '../../../server/api/admin/demo/reset.js'
import * as route15 from '../../../server/api/rooms/[roomId]/interviews/[sessionId]/index.js'
import * as route16 from '../../../server/api/rooms/[roomId]/change-requests/[reqId].js'
import * as route17 from '../../../server/api/applications/[id]/doc/[docId].js'
import * as route18 from '../../../server/api/rooms/[roomId]/change-requests/index.js'
import * as route19 from '../../../server/api/rooms/[roomId]/signed-contract-file.js'
import * as route20 from '../../../server/api/rooms/[roomId]/audit-certificate.js'
import * as route21 from '../../../server/api/rooms/[roomId]/final-offer-email.js'
import * as route22 from '../../../server/api/rooms/[roomId]/interview-summary.js'
import * as route23 from '../../../server/api/rooms/[roomId]/negotiation-check.js'
import * as route24 from '../../../server/api/rooms/[roomId]/interviews/index.js'
import * as route25 from '../../../server/api/rooms/[roomId]/interview-slots.js'
import * as route26 from '../../../server/api/rooms/[roomId]/signed-contract.js'
import * as route27 from '../../../server/api/rooms/[roomId]/contract-draft.js'
import * as route28 from '../../../server/api/rooms/[roomId]/employment-end.js'
import * as route29 from '../../../server/api/rooms/[roomId]/contract-view.js'
import * as route30 from '../../../server/api/rooms/[roomId]/link-previous.js'
import * as route31 from '../../../server/api/applications/[id]/send-code.js'
import * as route32 from '../../../server/api/rooms/[roomId]/confirm-hire.js'
import * as route33 from '../../../server/api/rooms/[roomId]/invite-email.js'
import * as route34 from '../../../server/api/admin/rooms/[roomId]/index.js'
import * as route35 from '../../../server/api/postings/[id]/applications.js'
import * as route36 from '../../../server/api/applications/[id]/reject.js'
import * as route37 from '../../../server/api/applications/[id]/screen.js'
import * as route38 from '../../../server/api/rooms/[roomId]/translate.js'
import * as route39 from '../../../server/api/documents/[id]/download.js'
import * as route40 from '../../../server/api/rooms/[roomId]/contract.js'
import * as route41 from '../../../server/api/rooms/[roomId]/messages.js'
import * as route42 from '../../../server/api/admin/users/[id]/index.js'
import * as route43 from '../../../server/api/applications/[id]/pass.js'
import * as route44 from '../../../server/api/rooms/[roomId]/analyze.js'
import * as route45 from '../../../server/api/rooms/[roomId]/archive.js'
import * as route46 from '../../../server/api/rooms/[roomId]/close.js'
import * as route47 from '../../../server/api/postings/[id]/reuse.js'
import * as route48 from '../../../server/api/rooms/[roomId]/sign.js'
import * as route49 from '../../../server/api/rooms/[roomId]/view.js'
import * as route50 from '../../../server/api/jobs/[id]/apply.js'
import * as route51 from '../../../server/api/admin/contracts/index.js'
import * as route52 from '../../../server/api/applications/claim.js'
import * as route53 from '../../../server/api/notifications/read.js'
import * as route54 from '../../../server/api/admin/rooms/index.js'
import * as route55 from '../../../server/api/admin/users/index.js'
import * as route56 from '../../../server/api/documents/upload.js'
import * as route57 from '../../../server/api/admin/audit-log.js'
import * as route58 from '../../../server/api/documents/mine.js'
import * as route59 from '../../../server/api/push/subscribe.js'
import * as route60 from '../../../server/api/rooms/create.js'
import * as route61 from '../../../server/api/rooms/enter.js'
import * as route62 from '../../../server/api/demo/login.js'
import * as route63 from '../../../server/api/rooms/join.js'
import * as route64 from '../../../server/api/push/key.js'
import * as route65 from '../../../server/api/applications/[id]/index.js'
import * as route66 from '../../../server/api/documents/[id]/index.js'
import * as route67 from '../../../server/api/posting-drafts/[id].js'
import * as route68 from '../../../server/api/postings/[id]/index.js'
import * as route69 from '../../../server/api/jobs/[id]/index.js'
import * as route70 from '../../../server/api/dm/[partnerId].js'
import * as route71 from '../../../server/api/my-applications/index.js'
import * as route72 from '../../../server/api/posting-drafts/index.js'
import * as route73 from '../../../server/api/notifications/index.js'
import * as route74 from '../../../server/api/application-status.js'
import * as route75 from '../../../server/api/applications/index.js'
import * as route76 from '../../../server/api/verify-certificate.js'
import * as route77 from '../../../server/api/change-password.js'
import * as route78 from '../../../server/api/postings/index.js'
import * as route79 from '../../../server/api/demo/index.js'
import * as route80 from '../../../server/api/jobs/index.js'
import * as route81 from '../../../server/api/dashboard.js'
import * as route82 from '../../../server/api/dm/index.js'
import * as route83 from '../../../server/api/logout.js'
import * as route84 from '../../../server/api/signup.js'
import * as route85 from '../../../server/api/login.js'
import * as route86 from '../../../server/api/me.js'
import * as route87 from '../../../server/api/[[path]].js'

export const routes = [
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recordings\\/([^/]+)\\/upload-ticket/?$"), params: ["roomId","sessionId","recordingId"], module: route0 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recordings\\/([^/]+)\\/complete/?$"), params: ["roomId","sessionId","recordingId"], module: route1 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recording\\/([^/]+)\\/control/?$"), params: ["roomId","sessionId","recordingId"], module: route2 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recordings\\/([^/]+)\\/retry/?$"), params: ["roomId","sessionId","recordingId"], module: route3 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recordings\\/([^/]+)\\/file/?$"), params: ["roomId","sessionId","recordingId"], module: route4 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recording\\/start/?$"), params: ["roomId","sessionId"], module: route5 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/recordings/?$"), params: ["roomId","sessionId"], module: route6 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/members/?$"), params: ["roomId","sessionId"], module: route7 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/join-token/?$"), params: ["roomId","sessionId"], module: route8 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/signaling/?$"), params: ["roomId","sessionId"], module: route9 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)\\/consent/?$"), params: ["roomId","sessionId"], module: route10 },
  { pattern: new RegExp("^/admin\\/users\\/([^/]+)\\/reset-password/?$"), params: ["id"], module: route11 },
  { pattern: new RegExp("^/admin\\/rooms\\/([^/]+)\\/messages/?$"), params: ["roomId"], module: route12 },
  { pattern: new RegExp("^/admin\\/contracts\\/([^/]+)\\/file/?$"), params: ["id"], module: route13 },
  { pattern: new RegExp("^/admin\\/demo\\/reset/?$"), params: [], module: route14 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews\\/([^/]+)/?$"), params: ["roomId","sessionId"], module: route15 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/change-requests\\/([^/]+)/?$"), params: ["roomId","reqId"], module: route16 },
  { pattern: new RegExp("^/applications\\/([^/]+)\\/doc\\/([^/]+)/?$"), params: ["id","docId"], module: route17 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/change-requests/?$"), params: ["roomId"], module: route18 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/signed-contract-file/?$"), params: ["roomId"], module: route19 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/audit-certificate/?$"), params: ["roomId"], module: route20 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/final-offer-email/?$"), params: ["roomId"], module: route21 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interview-summary/?$"), params: ["roomId"], module: route22 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/negotiation-check/?$"), params: ["roomId"], module: route23 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interviews/?$"), params: ["roomId"], module: route24 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/interview-slots/?$"), params: ["roomId"], module: route25 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/signed-contract/?$"), params: ["roomId"], module: route26 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/contract-draft/?$"), params: ["roomId"], module: route27 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/employment-end/?$"), params: ["roomId"], module: route28 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/contract-view/?$"), params: ["roomId"], module: route29 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/link-previous/?$"), params: ["roomId"], module: route30 },
  { pattern: new RegExp("^/applications\\/([^/]+)\\/send-code/?$"), params: ["id"], module: route31 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/confirm-hire/?$"), params: ["roomId"], module: route32 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/invite-email/?$"), params: ["roomId"], module: route33 },
  { pattern: new RegExp("^/admin\\/rooms\\/([^/]+)/?$"), params: ["roomId"], module: route34 },
  { pattern: new RegExp("^/postings\\/([^/]+)\\/applications/?$"), params: ["id"], module: route35 },
  { pattern: new RegExp("^/applications\\/([^/]+)\\/reject/?$"), params: ["id"], module: route36 },
  { pattern: new RegExp("^/applications\\/([^/]+)\\/screen/?$"), params: ["id"], module: route37 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/translate/?$"), params: ["roomId"], module: route38 },
  { pattern: new RegExp("^/documents\\/([^/]+)\\/download/?$"), params: ["id"], module: route39 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/contract/?$"), params: ["roomId"], module: route40 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/messages/?$"), params: ["roomId"], module: route41 },
  { pattern: new RegExp("^/admin\\/users\\/([^/]+)/?$"), params: ["id"], module: route42 },
  { pattern: new RegExp("^/applications\\/([^/]+)\\/pass/?$"), params: ["id"], module: route43 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/analyze/?$"), params: ["roomId"], module: route44 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/archive/?$"), params: ["roomId"], module: route45 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/close/?$"), params: ["roomId"], module: route46 },
  { pattern: new RegExp("^/postings\\/([^/]+)\\/reuse/?$"), params: ["id"], module: route47 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/sign/?$"), params: ["roomId"], module: route48 },
  { pattern: new RegExp("^/rooms\\/([^/]+)\\/view/?$"), params: ["roomId"], module: route49 },
  { pattern: new RegExp("^/jobs\\/([^/]+)\\/apply/?$"), params: ["id"], module: route50 },
  { pattern: new RegExp("^/admin\\/contracts/?$"), params: [], module: route51 },
  { pattern: new RegExp("^/applications\\/claim/?$"), params: [], module: route52 },
  { pattern: new RegExp("^/notifications\\/read/?$"), params: [], module: route53 },
  { pattern: new RegExp("^/admin\\/rooms/?$"), params: [], module: route54 },
  { pattern: new RegExp("^/admin\\/users/?$"), params: [], module: route55 },
  { pattern: new RegExp("^/documents\\/upload/?$"), params: [], module: route56 },
  { pattern: new RegExp("^/admin\\/audit-log/?$"), params: [], module: route57 },
  { pattern: new RegExp("^/documents\\/mine/?$"), params: [], module: route58 },
  { pattern: new RegExp("^/push\\/subscribe/?$"), params: [], module: route59 },
  { pattern: new RegExp("^/rooms\\/create/?$"), params: [], module: route60 },
  { pattern: new RegExp("^/rooms\\/enter/?$"), params: [], module: route61 },
  { pattern: new RegExp("^/demo\\/login/?$"), params: [], module: route62 },
  { pattern: new RegExp("^/rooms\\/join/?$"), params: [], module: route63 },
  { pattern: new RegExp("^/push\\/key/?$"), params: [], module: route64 },
  { pattern: new RegExp("^/applications\\/([^/]+)/?$"), params: ["id"], module: route65 },
  { pattern: new RegExp("^/documents\\/([^/]+)/?$"), params: ["id"], module: route66 },
  { pattern: new RegExp("^/posting-drafts\\/([^/]+)/?$"), params: ["id"], module: route67 },
  { pattern: new RegExp("^/postings\\/([^/]+)/?$"), params: ["id"], module: route68 },
  { pattern: new RegExp("^/jobs\\/([^/]+)/?$"), params: ["id"], module: route69 },
  { pattern: new RegExp("^/dm\\/([^/]+)/?$"), params: ["partnerId"], module: route70 },
  { pattern: new RegExp("^/my-applications/?$"), params: [], module: route71 },
  { pattern: new RegExp("^/posting-drafts/?$"), params: [], module: route72 },
  { pattern: new RegExp("^/notifications/?$"), params: [], module: route73 },
  { pattern: new RegExp("^/application-status/?$"), params: [], module: route74 },
  { pattern: new RegExp("^/applications/?$"), params: [], module: route75 },
  { pattern: new RegExp("^/verify-certificate/?$"), params: [], module: route76 },
  { pattern: new RegExp("^/change-password/?$"), params: [], module: route77 },
  { pattern: new RegExp("^/postings/?$"), params: [], module: route78 },
  { pattern: new RegExp("^/demo/?$"), params: [], module: route79 },
  { pattern: new RegExp("^/jobs/?$"), params: [], module: route80 },
  { pattern: new RegExp("^/dashboard/?$"), params: [], module: route81 },
  { pattern: new RegExp("^/dm/?$"), params: [], module: route82 },
  { pattern: new RegExp("^/logout/?$"), params: [], module: route83 },
  { pattern: new RegExp("^/signup/?$"), params: [], module: route84 },
  { pattern: new RegExp("^/login/?$"), params: [], module: route85 },
  { pattern: new RegExp("^/me/?$"), params: [], module: route86 },
  { pattern: new RegExp("^/(.*)$"), params: ["path"], module: route87 },
]
