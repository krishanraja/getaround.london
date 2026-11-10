# 2026-11-10: discoverability and social cards

STATUS: built, tested locally, merged to main (Krish asked for the merge). Production deploys from main via Vercel.
WHAT: sitemap index with image entries (505 URLs), four intent guide pages, three-ways table and six-question FAQ on
all 465 pair pages, llms.txt question map plus llms-full.txt, one social card per page (503), home card without the
roundel-like ring, more AI crawlers named in robots.txt.
VERIFIED: 62/62 tests, build self-check (every sitemap URL has its page and card), 1007 JSON-LD blocks parse, no em
dashes or kill-list words in 507 generated files, no sideways scroll at 360px on guide and pair pages, guide form
opens the live plan (Brixton + Camden Town -> Oxford Circus, same as the static page).
LIVE: production readback after deploy 56929a9: sitemap index, sitemap-meet, /og/home.png, a pair card, a guide page and
llms-full.txt all 200 with the right types; the Brixton + Camden Town page serves its own card and the three ways table.
NOT YET: submitting the sitemap
in Google Search Console and Bing Webmaster Tools (Krish's accounts); card previews checked in the real WhatsApp,
LinkedIn and X debuggers.
NEXT: Krish submits https://getaround.london/sitemap.xml in Search Console and Bing, then pastes one /meet link into
WhatsApp to see the new card.
NORTH STAR CHECK: more people find the fairest station to meet in about a minute. This adds entry points from search
and AI answers; the product itself is unchanged.
