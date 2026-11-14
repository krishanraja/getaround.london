# 2026-11-14: feedback form forwards through a server route (ruling 2.2)

STATUS: built and tested; merged to main on green CI (see the pull request). The live form still answers "Couldn't
send" until the two gates below close, the same as since the key was revoked.
WHY: the shared Mindmaker OS publishable key was revoked after it leaked from another site's public bundle. This
app never put that key in the browser (its bundle had no key), but its server function used it, so every note
failed. Mindmaker OS now lists no publishable key.
WHAT: /api/feedback validates the note, rate-limits the sender (5 per address per 10 minutes, per instance) and
forwards the clean row to a Control Center route with a one-write bearer, the krishraja.com enquiry pattern. No
database address or key in this app. Chosen over a direct write because Supabase has no key scoped to one table:
the only server key is the secret key, which can touch every table.
GUARD: npm run check:secrets fails CI on any key-shaped string in a tracked file; npm run build ends by scanning
dist/ for key shapes, server variable names and database addresses, so a Vercel deploy fails too.
VERIFIED: 67/67 tests; build clean with the dist scan; a planted fake key and a planted variable name each failed
the guard (exit 1, value not printed); the real handler against a local stand-in receiver forwarded with the bearer
(204) and refused an empty note (400) without sending.
NOT YET: the Control Center route that receives the note (POST /api/site/feedback, holding only the bearer's
sha256 and calling submit_product_feedback with the server key) does not exist; a control-center session builds
it. Then Krish sets FEEDBACK_FORWARD_URL and FEEDBACK_FORWARD_BEARER in Vercel.
NEXT: control-center session builds the receiver; Krish sets the two variables; one real note from the live form.
NORTH STAR CHECK: more people find the fairest station to meet in about a minute. Feedback is how the product learns
what stops them; this restores that channel without a key anyone can lift.
