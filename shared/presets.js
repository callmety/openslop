// OpenSlop — Preset Catalog
// ─────────────────────────────────────────────────────────────────────────────
// Curated categories of AI-slop phrases, hashtags, and buzzwords. The
// catalog is site-agnostic; some terms today are weighted toward the
// patterns seen most on the shipping adapter's host, but the structure
// is meant to grow with new adapters.
// All presets are OFF by default — users opt in per category or per term.
//
// Data shape:
//   HU_PRESETS: Array<{
//     id:          string,          // stable machine ID (never rename)
//     label:       string,          // display name
//     description: string,          // one-line tooltip/subtitle
//     sensitive?:  boolean,         // if true, term text is masked in the UI
//     terms: Array<{
//       id:   string,               // stable machine ID (never rename)
//       text: string,               // raw term passed to compileBlacklist()
//     }>
//   }>
//
// Rules for adding new terms:
//   • Prefer multi-word phrases over single broad words
//   • Avoid generic single words like "leadership", "ai", "growth"
//   • Hashtags are fine when specific (#grindset, not #ai)
//   • New IDs must be unique across ALL categories
//
// Removed terms (kept here as tombstones so IDs are never accidentally reused):
//   humble-brags:    excited-to-share-ive-accepted, thrilled-to-announce-ive-joined,
//                    hb-happy-to-share-started-new-position, hb-exciting-news-to-share-with-linkedin,
//                    hb-the-best-is-yet-to-come
//   lead-magnets:    lm-steal-my, lm-copy-my-exact, lm-free-playbook, lm-free-framework,
//                    lm-want-the-doc
//   ai-slop-voice:   asv-read-that-again, asv-let-that-sink-in, asv-the-future-belongs-to-those-who,
//                    asv-this-is-your-reminder-that, asv-here-are-n-brutal-truths,
//                    asv-unpopular-opinion-colon
//   hustle-culture:  hustle-harder
//   recruiter-spam:  rs-urgent-hiring, rs-immediately-hiring, rs-urgent-requirement,
//                    rs-uncapped-commission, rs-hiring-for-multiple-roles,
//                    rs-multiple-openings-across, rs-limited-seats
//   numbers-theater: nt-i-just-analyzed
// ─────────────────────────────────────────────────────────────────────────────

/* global normalizeText */
/* exported HU_PRESETS, HU_SLOP_LEVELS,
            getPresetEnabledIds, getEnabledPresetTerms, getEffectiveBlacklist,
            getSlopSensitivityTerms, getSlopSensitivityDescriptor,
            getSlopHeuristicThreshold, getSliderManagedTermIdsAtLevel */

var HU_PRESETS = [

  // ── Humble Brags ───────────────────────────────────────────────────────────
  // Only long, specific formulas that are unambiguously performative.
  // Generic openers like "excited to share" are kept at specific/compound forms
  // to avoid false-positives on genuine announcements.
  {
    id: 'humble-brags',
    emoji: '🏆',
    label: 'Humble Brags',
    description: 'Achievement posts wrapped in ceremonial self-congratulation.',
    terms: [
      { id: 'humbled-and-honored-to-receive',          text: 'humbled and honored to receive' },
      { id: 'hb-thrilled-to-announce-joining',         text: "thrilled to announce" },
      { id: 'hb-so-grateful-to-announce',              text: 'so grateful to announce' },
      { id: 'hb-humbled-to-share',                     text: 'humbled to share' },
      { id: 'hb-excited-for-this-next-chapter',        text: 'excited for this next chapter' },
      { id: 'hb-a-humble-honour',                      text: 'a humble honour' },
      { id: 'hb-it-was-an-absolute-pleasure-invited',  text: 'it was an absolute pleasure to be invited' },
      { id: 'hb-honoured-to-be-a-speaker',             text: 'honoured to be a speaker' },
      { id: 'hb-honored-to-be-a-speaker',              text: 'honored to be a speaker' },
      { id: 'hb-proud-to-be-emceeing',                 text: 'proud to be emceeing' },
      { id: 'hb-thank-you-for-congratulations-on-my-appointment', text: 'thank you to all who\'ve sent congratulations on my appointment' },
      { id: 'hb-workversary',                          text: 'workversary' },
      { id: 'hb-dear-network',                         text: 'dear network,' },
      { id: 'hb-can-i-get-an-amen',                    text: 'can i get an amen' },
    ],
  },

  // ── Lead Magnets ──────────────────────────────────────────────────────────
  // Long, specific keyword-comment funnels only. Short 2-word fragments removed
  // (free playbook, steal my, etc.) — too broad, high false-positive risk.
  {
    id: 'lead-magnets',
    emoji: '🧲',
    label: 'Lead Magnets',
    description: 'Keyword-comment funnels for free templates, guides, and checklists.',
    terms: [
      { id: 'lm-comment-below-for-the-free-template',            text: 'comment below for the free template' },
      { id: 'lm-comment-below-for-the-checklist',                text: 'comment below for the checklist' },
      { id: 'lm-comment-below-for-the-playbook',                 text: 'comment below for the playbook' },
      { id: 'lm-comment-the-word-template-and-ill-send-it',      text: "comment the word template and i'll send it" },
      { id: 'lm-comment-the-word-guide-and-ill-send-it',         text: "comment the word guide and i'll send it" },
      { id: 'lm-comment-guide-and-ill-send-it',                  text: "comment guide and i'll send it" },
      { id: 'lm-comment-checklist-and-ill-send-it',              text: "comment checklist and i'll send it" },
      { id: 'lm-ill-send-the-template-to-everyone-who-comments', text: "i'll send the template to everyone who comments" },
      { id: 'lm-ill-dm-the-guide-to-everyone-who-comments',      text: "i'll dm the guide to everyone who comments" },
      { id: 'lm-comment-or-reply-keyword-and-ill-send',           text: '/\\b(?:comment|reply)\\s+["\'][a-z0-9&+ \\-]{1,12}["\']\\s+and\\s+i(?:\'|\\u2019)ll\\s+(?:send|dm)\\b/i' },
    ],
  },

  // ── Engagement Bait ───────────────────────────────────────────────────────
  // High-signal mechanical bait patterns only.
  {
    id: 'engagement-bait',
    emoji: '🎣',
    label: 'Engagement Bait',
    description: 'Comment farming, prompt bait, and audience fishing.',
    terms: [
      { id: 'tag-someone-who-needs',             text: 'tag someone who needs this' },
      { id: 'repost-if-you-agree',               text: 'repost if you agree' },
      { id: 'comment-below-and-ill-send',        text: "comment below and i'll send" },
      { id: 'drop-a-comment-and-ill-send',       text: "drop a comment and i'll send" },
      { id: 'comment-yes-if-you-agree',          text: 'comment yes if you agree' },
      { id: 'comment-interested-and-ill-send',   text: "comment interested and i'll send" },
      { id: 'share-this-with-someone-who-needs', text: 'share this with someone who needs this' },
      { id: 'eb-agree',                          text: 'agree?' },
      { id: 'eb-agree-or-not',                   text: 'agree or not?' },
      { id: 'eb-wdyt',                           text: 'wdyt' },
    ],
  },

  // ── AI Hype ───────────────────────────────────────────────────────────────
  // Inflated-claim and greed-signal phrasing. Neutral product descriptors
  // (powered by ai, built with ai, ai-powered) excluded.
  {
    id: 'ai-hype',
    emoji: '🤖',
    label: 'AI Hype',
    description: 'Inflated AI automation claims and one-person-unicorn theater.',
    terms: [
      { id: 'ten-x-your-productivity-with-ai',          text: '10x your productivity with ai' },
      { id: 'replace-your-team-with-ai',                text: 'replace your team with ai' },
      { id: 'one-person-unicorn',                       text: 'one-person unicorn' },
      { id: 'build-startup-solo-with-ai',               text: 'build a startup solo with ai' },
      { id: 'aih-built-an-ai-that-writes-better-dms',   text: 'built an ai that writes better dms than me' },
      { id: 'aih-from-one-insight-uncovered-by-ai',     text: 'from one insight uncovered by an ai agent' },
    ],
  },

  // ── AI Slop Voice / Broetry ───────────────────────────────────────────────
  // Distinct from AI Hype (which is about AI as a topic).
  // Pseudo-poetic, GPT-cadence phrases and synthetic-profundity tropes that
  // appear regardless of topic. Short fragments with legit uses removed.
  {
    id: 'ai-slop-voice',
    emoji: '📝',
    label: 'AI Slop Voice',
    description: 'Broetry cadence, pseudo-profundity, and synthetic "deep thought" openers.',
    terms: [
      { id: 'asv-the-people-who-get-it-get-it',      text: 'the people who get it get it' },
      { id: 'asv-you-are-not-behind-you-are-early',  text: 'you are not behind you are early' },
      { id: 'asv-in-a-world-obsessed-with',          text: 'in a world obsessed with' },
      { id: 'asv-most-people-arent-ready-for-this',  text: "most people aren't ready for this" },
      { id: 'asv-no-one-talks-about-this-but',       text: 'no one talks about this but' },
      { id: 'asv-nobody-talks-about-this-but',       text: 'nobody talks about this but' },
      { id: 'asv-manifestation-is-not-about-wishing', text: 'manifestation is not about wishing harder' },
      { id: 'asv-become-the-version-of-you',          text: 'become the version of you that' },
      { id: 'asv-heres-the-thing-nobody-tells-you',   text: "here's the thing nobody tells you" },
    ],
  },

  // ── AI Brochure Voice ─────────────────────────────────────────────────────
  // Unmistakable GPT scene-setting and over-polished brochure filler.
  // Kept intentionally small: only long formulas with near-zero false positives.
  // Nothing a real human would write in genuine professional prose.
  {
    id: 'ai-prose-tells',
    emoji: '🥱',
    label: 'AI Brochure Voice',
    description: 'That unmistakable ChatGPT brochure voice: vague scene-setting, polished filler, and empty gravitas.',
    terms: [
      { id: 'aipt-in-todays-fast-paced-world',      text: "in today's fast-paced world" },
      { id: 'aipt-in-this-ever-evolving-landscape', text: 'in this ever-evolving landscape' },
      { id: 'aipt-considerable-challenges-that-require-careful-consideration', text: 'considerable challenges that require careful consideration and strategic planning' },
    ],
  },

  // ── Corporate Speak ────────────────────────────────────────────────────────
  // Compounded jargon phrases only — common idioms excluded.
  {
    id: 'corporate-speak',
    emoji: '💼',
    label: 'Corporate Speak',
    description: 'Compounded buzzword jargon that signals low-information content.',
    terms: [
      { id: 'unlock-cross-functional-synergies',  text: 'unlock cross-functional synergies' },
      { id: 'synergize-our-efforts',              text: 'synergize our efforts' },
      { id: 'leverage-our-core-competencies',     text: 'leverage our core competencies' },
      { id: 'move-fast-and-break-silos',          text: 'move fast and break silos' },
      { id: 'cs2-harnessing-the-power-of-ai',     text: 'harnessing the power of ai' },
      { id: 'cs2-customer-delight-officer',       text: 'customer delight officer' },
      { id: 'cs2-sparks-customer-delight',        text: 'sparks customer delight' },
      { id: 'cs2-bringing-authentic-self-to-work', text: 'bringing your authentic self to work' },
      { id: 'cs2-committed-to-best-practices',    text: 'committed to best practices' },
      { id: 'cs2-differentiation-strategy',       text: 'differentiation strategy' },
    ],
  },

  // ── Performative Openers ──────────────────────────────────────────────────
  // Self-aware meta-framing and contrarian theater with no legitimate use.
  // Includes story-bait openers that wrap a pitch inside dramatic anecdotes.
  {
    id: 'performative-openers',
    emoji: '🎭',
    label: 'Performative Openers',
    description: 'Formulaic pseudo-insight, contrarian openers, and manufactured controversy.',
    terms: [
      { id: 'not-sure-who-needs-to-hear',          text: 'not sure who needs to hear this' },
      { id: 'about-to-say-controversial',          text: "i'm about to say something controversial" },
      { id: 'ready-for-a-hot-take',                text: 'ready for a hot take' },
      { id: 'i-said-what-i-said',                  text: 'i said what i said' },
      { id: 'ill-probably-get-hate-for-this',      text: "i'll probably get hate for this" },
      { id: 'po-ill-never-forget-this-conversation', text: "i'll never forget this conversation" },
      { id: 'po-as-a-founder-dad-and-coach',        text: 'as a founder, dad, and coach' },
      { id: 'po-and-then-it-hit-me',                text: 'and then it hit me' },
    ],
  },

  // ── Motivational Platitudes ───────────────────────────────────────────────
  // Longer, specific platitude tropes. Short generic encouragement excluded.
  {
    id: 'motivational-platitudes',
    emoji: '✨',
    label: 'Motivational Platitudes',
    description: 'Low-information optimism, self-help clichés, and pseudo-wisdom.',
    terms: [
      { id: 'consistency-is-the-real-flex',         text: 'consistency is the real flex' },
      { id: 'your-only-competition-is-yesterday',   text: 'your only competition is who you were yesterday' },
      { id: 'mp-this-is-not-luck-this-is-law',      text: 'this is not luck this is law' },
      { id: 'mp-i-believe-in-you-100-percent',      text: 'i believe in you 100%' },
      { id: 'mp-results-reflection-internal-state',       text: 'your results are a reflection of your internal state' },
      { id: 'mp-your-reputation-is-your-leverage',         text: 'your reputation is your leverage' },
      { id: 'mp-your-identity-is-your-brand',              text: 'your identity is your brand' },
      { id: 'mp-first-impressions-rarely-happen-in-person', text: 'first impressions rarely happen in person anymore' },
    ],
  },

  // ── Personal-Life Fables ──────────────────────────────────────────────────
  // The "the feed turned into Facebook" complaint in filter form.
  // Moral lessons extracted from Uber drivers, toddlers, baristas, and strangers.
  {
    id: 'personal-life-fables',
    emoji: '🚕',
    label: 'Personal-Life Fables',
    description: 'Business lessons from Uber drivers, toddlers, baristas, and random strangers.',
    terms: [
      { id: 'plf-my-uber-driver-taught-me',          text: 'my uber driver taught me' },
      { id: 'plf-my-uber-driver-asked-me',           text: 'my uber driver asked me' },
      { id: 'plf-my-daughter-asked-me-why',          text: 'my daughter asked me why' },
      { id: 'plf-my-son-asked-me-why',               text: 'my son asked me why' },
      { id: 'plf-my-toddler-reminded-me-that',       text: 'my toddler reminded me that' },
      { id: 'plf-my-toddler-taught-me',              text: 'my toddler taught me' },
      { id: 'plf-the-barista-taught-me',             text: 'the barista taught me' },
      { id: 'plf-the-janitor-taught-me',             text: 'the janitor taught me' },
      { id: 'plf-the-cashier-reminded-me',           text: 'the cashier reminded me' },
      { id: 'plf-my-flight-delay-taught-me',         text: 'my flight delay taught me' },
      { id: 'plf-a-stranger-on-the-plane-taught-me', text: 'a stranger on the plane taught me' },
      { id: 'plf-i-never-post-personal-but',         text: 'i never post anything personal on linkedin, but' },
      { id: 'plf-my-dog-taught-me',                  text: 'my dog taught me' },
    ],
  },

  // ── Hustle Culture ────────────────────────────────────────────────────────
  // Unambiguous grind-theater phrases. "hustle harder" (2 words, too broad) removed.
  {
    id: 'hustle-culture',
    emoji: '💪',
    label: 'Hustle Culture',
    description: 'Work-maxxing and grind theater.',
    terms: [
      { id: 'rise-and-grind',            text: 'rise and grind' },
      { id: 'sleep-is-overrated',        text: 'sleep is overrated' },
      { id: 'grindset',                  text: '#grindset' },
      { id: 'embrace-the-grind',         text: 'embrace the grind' },
      { id: 'work-while-they-sleep',     text: 'work while they sleep' },
      { id: 'be-obsessed-or-be-average', text: 'be obsessed or be average' },
      { id: 'nobody-cares-work-harder',  text: 'nobody cares work harder' },
      { id: 'winners-work-weekends',     text: 'winners work weekends' },
      { id: 'eat-sleep-grind-repeat',    text: 'eat sleep grind repeat' },
      { id: 'hc-requires-grind-mentality', text: 'requires grind mentality' },
    ],
  },

  // ── Recruiter Spam / Scammy Jobs ──────────────────────────────────────────
  // High-specificity scam-adjacent phrases only. Broad 2-word terms removed
  // (urgent hiring, uncapped commission, etc.) — too many legit uses.
  {
    id: 'recruiter-spam',
    emoji: '📨',
    label: 'Recruiter Spam',
    description: 'Scammy job bait, DM-your-resume blasts, and commission-only traps.',
    terms: [
      { id: 'rs-no-experience-needed',          text: 'no experience needed' },
      { id: 'rs-commission-only-role',          text: 'commission only role' },
      { id: 'rs-work-from-your-phone',          text: 'work from your phone' },
      { id: 'rs-dm-me-your-resume',             text: 'dm me your resume' },
      { id: 'rs-direct-message-me-your-resume', text: 'direct message me your resume' },
      { id: 'rs-send-your-cv-on-whatsapp',      text: 'send your cv on whatsapp' },
      { id: 'rs-no-interview-required',         text: 'no interview required' },
      { id: 'rs-earn-from-home',                text: 'earn from home' },
    ],
  },

  // ── Low-Signal Comments ───────────────────────────────────────────────────
  // Formulaic comment-section filler: empty affirmations, comment-farming
  // rituals, and engagement-bait call-and-response patterns that add zero
  // information value. Scoped to multi-word or very specific tokens only —
  // single-word affirmations excluded (too many legitimate uses).
  {
    id: 'low-signal-comments',
    emoji: '🗨️',
    label: 'Low-Signal Comments',
    description: 'Empty affirmations, CFBR rituals, and engagement-farming boilerplate.',
    terms: [
      { id: 'lsc-cfbr',                          text: 'cfbr' },
      { id: 'lsc-commenting-for-better-reach',   text: 'commenting for better reach' },
      { id: 'lsc-great-post',                    text: 'great post!' },
      { id: 'lsc-great-share',                   text: 'great share!' },
      { id: 'lsc-so-true',                       text: 'so true!' },
      { id: 'lsc-this-is-so-true',               text: 'this is so true' },
      { id: 'lsc-absolutely-this',               text: 'absolutely this!' },
      { id: 'lsc-well-said',                     text: 'well said!' },
      { id: 'lsc-love-this',                     text: 'love this!' },
      { id: 'lsc-great-insight',                 text: 'great insight' },
      { id: 'lsc-thanks-for-sharing',            text: 'thanks for sharing!' },
      { id: 'lsc-thank-you-for-sharing',         text: 'thank you for sharing' },
      { id: 'lsc-please-check-my-dm',            text: 'please check my dm' },
      { id: 'lsc-please-check-dms',              text: 'please check dms' },
      { id: 'lsc-check-your-dm',                 text: 'check your dm' },
      { id: 'lsc-followed-for-more',             text: 'followed for more' },
      { id: 'lsc-following-for-more',            text: 'following for more content' },
      { id: 'lsc-so-insightful',                 text: 'so insightful!' },
      { id: 'lsc-this-is-gold',                  text: 'this is gold!' },
      { id: 'lsc-pure-gold',                     text: 'pure gold!' },
      { id: 'lsc-saved-for-later',               text: 'saving this for later' },
      { id: 'lsc-interested',                    text: 'interested!' },
    ],
  },

  // ── Job Scam / Placeholder Jobs ───────────────────────────────────────────
  // Placeholder, scam-adjacent, and mass-hiring-bait phrasing specific to job
  // cards and recruiter posts — distinct from the existing recruiter-spam
  // category (which focuses on DM/spam patterns, not job-card shell signals).
  {
    id: 'job-scam-signals',
    emoji: '🚩',
    label: 'Job Scam / Placeholder Job Signals',
    description: 'WhatsApp-first flows, mass-hiring bait, and placeholder listing boilerplate.',
    terms: [
      { id: 'jss-apply-on-whatsapp',              text: 'apply on whatsapp' },
      { id: 'jss-contact-on-whatsapp',            text: 'contact on whatsapp' },
      { id: 'jss-whatsapp-only',                  text: 'whatsapp only' },
      { id: 'jss-mass-hiring',                    text: 'mass hiring' },
      { id: 'jss-bulk-hiring',                    text: 'bulk hiring' },
      { id: 'jss-hiring-1000-candidates',         text: 'hiring 1000' },
      { id: 'jss-work-from-home-daily-pay',       text: 'work from home daily pay' },
      { id: 'jss-earn-usd-per-day',               text: 'earn $50 per day' },
      { id: 'jss-daily-earnings',                 text: 'daily earnings from home' },
      { id: 'jss-100-percent-remote-worldwide',   text: '100% remote worldwide' },
      { id: 'jss-hiring-globally-no-experience',  text: 'hiring globally no experience' },
      { id: 'jss-no-qualifications-needed',       text: 'no qualifications needed' },
      { id: 'jss-anyone-can-apply',               text: 'anyone can apply' },
      { id: 'jss-paid-per-task',                  text: 'paid per task' },
      { id: 'jss-paid-per-click',                 text: 'paid per click' },
      { id: 'jss-easy-online-job',                text: 'easy online job' },
      { id: 'jss-guaranteed-placement',           text: 'guaranteed placement' },
      { id: 'jss-spot-offer',                     text: 'spot offer' },
      { id: 'jss-immediate-joiners-only',         text: 'immediate joiners only' },
      { id: 'jss-freshers-welcome-no-experience', text: 'freshers welcome no experience required' },
    ],
  },

  // ── Pseudo-Vulnerability / Trauma-Bait ────────────────────────────────────
  // Formulaic confessional hooks that frame manufactured vulnerability as
  // a content strategy. Curated to avoid flagging sincere personal writing:
  // terms are multi-word formulas with no plausible alternative context.
  {
    id: 'trauma-bait',
    emoji: '😢',
    label: 'Pseudo-Vulnerability / Trauma-Bait',
    description: 'Formulaic confessional openers used as engagement hooks.',
    terms: [
      { id: 'tb-wasnt-going-to-share',          text: "i wasn't going to share this" },
      { id: 'tb-not-going-to-share-this',       text: "i'm not going to share this" },
      { id: 'tb-this-broke-me',                 text: 'this broke me' },
      { id: 'tb-this-shattered-me',             text: 'this shattered me' },
      { id: 'tb-heres-what-my-worst-year',      text: "here's what my worst year taught me" },
      { id: 'tb-heres-what-rock-bottom',        text: "here's what hitting rock bottom taught me" },
      { id: 'tb-rock-bottom-taught-me',         text: 'rock bottom taught me' },
      { id: 'tb-the-darkest-chapter-of-my-life', text: 'the darkest chapter of my life' },
      { id: 'tb-almost-gave-up-on',             text: 'i almost gave up on' },
      { id: 'tb-i-was-at-my-lowest',            text: 'i was at my lowest' },
      { id: 'tb-nobody-knew-i-was-struggling',  text: 'nobody knew i was struggling' },
      { id: 'tb-failed-publicly',               text: 'i failed publicly' },
      { id: 'tb-i-lost-everything',             text: 'i lost everything' },
      { id: 'tb-when-i-was-at-my-lowest',       text: 'when i was at my lowest point' },
      { id: 'tb-difficult-truth-about',         text: 'the difficult truth about' },
      { id: 'tb-brave-enough-to-share',         text: "i'm brave enough to share" },
    ],
  },

  // ── Founder / VC / Growth Theatre ─────────────────────────────────────────
  // Startup performance theater: revenue-signal posts, fake "build in public"
  // playbooks, and investor-status performance boilerplate. Distinct from
  // numbers-theater (which is about generic outcome claims) — this category
  // targets the founder/VC persona specifically.
  {
    id: 'founder-theater',
    emoji: '🚀',
    label: 'Founder / VC / Growth Theatre',
    description: 'Revenue-signal theater, fake build-in-public playbooks, and investor performance boilerplate.',
    terms: [
      { id: 'ft-we-hit-x-in-y-days',            text: 'we hit $' },
      { id: 'ft-from-zero-to-x',                text: 'from zero to $' },
      { id: 'ft-x-to-x-arr',                    text: 'arr in' },
      { id: 'ft-build-in-public',                text: 'building in public' },
      { id: 'ft-build-in-public-thread',         text: 'building in public thread' },
      { id: 'ft-our-mrr-just-hit',               text: 'our mrr just hit' },
      { id: 'ft-crossing-x-users',               text: 'crossing 1 million users' },
      { id: 'ft-we-just-raised',                 text: 'we just raised' },
      { id: 'ft-proud-to-announce-our-round',    text: 'proud to announce our' },
      { id: 'ft-just-closed-our-seed',           text: 'just closed our seed' },
      { id: 'ft-just-closed-our-series',         text: 'just closed our series' },
      { id: 'ft-our-startup-just',               text: 'our startup just' },
      { id: 'ft-vc-backed',                      text: 'vc-backed startup' },
      { id: 'ft-backed-by-top-vcs',              text: 'backed by top vcs' },
      { id: 'ft-profitable-in-x-months',         text: 'profitable in 6 months' },
      { id: 'ft-zero-to-one-playbook',           text: 'zero to one playbook' },
      { id: 'ft-solopreneur-to-x',               text: 'solopreneur to' },
      { id: 'ft-not-doing-founder-led-content',   text: 'not doing founder-led content is insane' },
    ],
  },

  // ── Numbers Theater ───────────────────────────────────────────────────────
  // Outcome-claim posts built on a formula: specific number + revenue/rate/deal
  // claim + "here's the exact playbook/system/breakdown." Only multi-word
  // diagnostic phrases — generic dollar amounts have high false-positive risk.
  {
    id: 'numbers-theater',
    emoji: '📊',
    label: 'Numbers Theater',
    description: 'Revenue/rate claims paired with "exact playbook" or before/after metrics.',
    terms: [
      { id: 'nt-heres-the-exact-playbook',   text: "here's the exact playbook" },
      { id: 'nt-in-new-revenue-from-one',    text: 'in new revenue from one' },
      { id: 'nt-response-rates-overnight',   text: 'response rates overnight' },
      { id: 'nt-booked-calls-with-prospects', text: 'booked calls with prospects who never responded' },
    ],
  },

  // ── Thought Leader Fishing ────────────────────────────────────────────────
  // Countdown-list posts, "N things I wish I knew", and formulaic listicle hooks
  // that signal low-signal content farming rather than genuine expertise.
  // Excludes: legitimate numbered tutorials, step-by-step guides, product lists.
  {
    id: 'thought-leader-fishing',
    emoji: '🎯',
    label: 'Thought Leader Fishing',
    description: 'Countdown list bait, "N things I wish I knew", and listicle-hook openers.',
    terms: [
      { id: 'tlf-x-things-i-wish-i-knew',          text: 'things i wish i knew before' },
      { id: 'tlf-x-brutal-lessons',                 text: 'brutal lessons i learned' },
      { id: 'tlf-x-harsh-truths',                   text: 'harsh truths nobody tells you' },
      { id: 'tlf-x-signs-you-are-destined',         text: 'signs you are destined for greatness' },
      { id: 'tlf-x-things-successful-people',       text: 'things successful people do every morning' },
      { id: 'tlf-x-things-high-performers',         text: 'things high performers never do' },
      { id: 'tlf-x-habits-of-highly-effective',     text: 'habits of highly effective' },
      { id: 'tlf-x-lessons-from-spending',          text: 'lessons from spending' },
      { id: 'tlf-screenshots-speak-louder',         text: 'screenshots speak louder than words' },
      { id: 'tlf-save-this-for-later',              text: 'save this post for later' },
      { id: 'tlf-bookmark-this',                    text: 'bookmark this' },
      { id: 'tlf-print-this-and-put-it-on-wall',    text: 'print this and put it on your wall' },
      { id: 'tlf-share-this-before-linkedin-hides', text: 'share this before linkedin hides it' },
      { id: 'tlf-this-post-will-get-buried',        text: 'this post will get buried' },
      { id: 'tlf-read-that-again',                  text: 'read that again' },
      { id: 'tlf-read-that-twice',                  text: 'read that twice' },
    ],
  },

  // ── Crypto / NFT / Web3 Hype ──────────────────────────────────────────────
  // Unambiguous crypto-hype and speculative-investment phrasing that appears
  // in feed posts. Neutral product/tech descriptors excluded.
  {
    id: 'crypto-hype',
    emoji: '🪙',
    label: 'Crypto / NFT / Web3 Hype',
    description: 'Get-rich-quick crypto promises, NFT flex, and Web3 vaporware theater.',
    terms: [
      { id: 'ch-your-bank-doesnt-want-you-to-know', text: "your bank doesn't want you to know" },
      { id: 'ch-crypto-will-make-you-rich',         text: 'crypto will make you rich' },
      { id: 'ch-this-coin-is-going-to-moon',        text: 'going to the moon' },
      { id: 'ch-buy-before-it-moons',               text: 'buy before it moons' },
      { id: 'ch-100x-potential',                    text: '100x potential' },
      { id: 'ch-nft-drop',                          text: 'nft drop' },
      { id: 'ch-mint-your-nft',                     text: 'mint your nft' },
      { id: 'ch-web3-is-the-future',                text: 'web3 is the future of' },
      { id: 'ch-blockchain-will-disrupt',           text: 'blockchain will disrupt' },
      { id: 'ch-passive-income-with-crypto',        text: 'passive income with crypto' },
      { id: 'ch-financial-freedom-through-crypto',  text: 'financial freedom through crypto' },
      { id: 'ch-decentralized-future',              text: 'decentralized future' },
      { id: 'ch-this-is-not-financial-advice-but',  text: 'this is not financial advice but' },
    ],
  },

  // ── AI Prompt Artifacts ───────────────────────────────────────────────────
  // Accidental ChatGPT/LLM preambles pasted directly into posts. These phrases
  // are the beginning of an AI response or prompt — never written by a human
  // author in a genuine post context.
  {
    id: 'ai-prompt-artifacts',
    emoji: '🧾',
    label: 'AI Prompt Artifacts',
    description: 'Accidental ChatGPT/LLM preambles pasted directly into posts.',
    terms: [
      { id: 'apa-heres-your-high-engagement-version',         text: "here's your high-engagement version" },
      { id: 'apa-heres-your-shorter-high-engagement-version', text: "here's your shorter, high-engagement version" },
      { id: 'apa-turn-this-into-a-linkedin-post',             text: 'turn this into a linkedin post' },
      { id: 'apa-rewrite-this-for-linkedin',                  text: 'rewrite this for linkedin' },
      { id: 'apa-make-this-more-punchy-for-linkedin',         text: 'make this more punchy for linkedin' },
      { id: 'apa-as-an-ai-language-model',                    text: 'as an ai language model' },
      { id: 'apa-i-dont-have-personal-opinions-but',          text: "i don't have personal opinions but" },
    ],
  },

  // ── Inbox Cold Pitches ────────────────────────────────────────────────────
  // Generic sales openers, Calendly funnel phrasing, and volume-recruiter
  // templates as they appear in message previews.
  // Opt-in only — NOT included in Recommended (too aggressive for first run).
  {
    id: 'inbox-cold-pitches',
    emoji: '📥',
    label: 'Inbox Cold Pitches',
    description: 'Sales openers, Calendly funnels, and volume-recruiter templates in message previews.',
    terms: [
      // Generic sales openers
      { id: 'icp-came-across-your-profile',     text: 'came across your profile and wanted to reach out' },
      { id: 'icp-thought-right-person',         text: "thought you'd be the right person to reach out to" },
      { id: 'icp-not-sure-right-person',        text: "not sure if you're the right person but" },
      { id: 'icp-introduce-myself-company',     text: 'wanted to introduce myself and my company' },
      { id: 'icp-we-help-companies-like-yours', text: 'we help companies like yours' },
      { id: 'icp-helping-teams-like-yours',     text: 'helping teams like yours' },
      { id: 'icp-15-minutes-on-calendar',       text: 'would love to get 15 minutes on your calendar' },
      { id: 'icp-quick-call-this-week',         text: 'would love to hop on a quick call this week' },
      { id: 'icp-open-to-connect',              text: 'open to a quick connect' },
      // Calendly funnel phrasing
      { id: 'icp-heres-my-calendly',            text: "here's my calendly" },
      { id: 'icp-grab-time-on-calendar',        text: 'grab time on my calendar' },
      { id: 'icp-pick-a-time-that-works',       text: 'pick a time that works for you' },
      { id: 'icp-book-time-with-me-here',       text: 'book time with me here' },
      { id: 'icp-schedule-time-on-my-calendar', text: 'schedule time on my calendar' },
      { id: 'icp-calendly-link',                text: 'calendly.com/' },
      // Volume recruiter templates
      { id: 'icp-open-to-new-opportunities',    text: "if you're open to new opportunities" },
      { id: 'icp-based-on-your-background',     text: 'based on your background' },
      { id: 'icp-one-of-our-clients-looking',   text: 'one of our clients is looking for' },
      { id: 'icp-several-openings',             text: 'we have several openings that may interest you' },
      { id: 'icp-share-updated-resume',         text: 'share your updated resume' },
      { id: 'icp-current-ctc-notice-period',    text: 'current ctc and notice period' },
      { id: 'icp-send-cv-contact-number',       text: 'send me your cv and contact number' },
    ],
  },

  // ── Franchise Spam ────────────────────────────────────────────────────────
  // Franchise-for-sale pitches and turnkey owner-operator opportunity posts.
  // Distinct from recruiter-spam (which is about job listings) — this category
  // targets paid franchise opportunity ads dressed up as feed posts.
  {
    id: 'franchise-spam',
    emoji: '🏪',
    label: 'Franchise Spam',
    description: 'Franchise-for-sale pitches and turnkey owner-operator opportunity posts.',
    terms: [
      { id: 'frs-franchise-licenses-for-motivated',   text: 'franchise licenses for motivated entrepreneurs' },
      { id: 'frs-established-franchise-model',        text: 'established franchise model' },
      { id: 'frs-available-franchise-opportunities',  text: 'available franchise opportunities' },
      { id: 'frs-years-of-franchise-experience',      text: 'years of franchise experience' },
      { id: 'frs-own-your-future-make-impact',        text: 'own your future, make a positive impact' },
      { id: 'frs-proven-systems-to-open-and-operate',  text: 'systems needed to successfully open and operate' },
    ],
  },

  // ── Consultant Speak ──────────────────────────────────────────────────────
  // Consulting/coaching funnel jargon about "hidden revenue," "scaling assets,"
  // and "profit acceleration." More specific than corporate-speak — these are
  // signature phrases of the one-person-consultant feed persona.
  {
    id: 'consultant-speak',
    emoji: '📈',
    label: 'Consultant Speak',
    description: 'Coaching funnel jargon about hidden revenue, scaling assets, and profit acceleration.',
    terms: [
      { id: 'cs-unlock-hidden-revenue',                 text: 'unlock hidden revenue' },
      { id: 'cs-stop-guessing-your-growth',             text: 'stop guessing your growth' },
      { id: 'cs-profit-acceleration-strategist',        text: 'profit acceleration strategist' },
      { id: 'cs-hidden-profit-centers',                 text: 'hidden profit centers' },
      { id: 'cs-entrepreneurial-guesswork',             text: 'entrepreneurial guesswork' },
      { id: 'cs-running-a-business-to-scaling-an-asset', text: 'running a business to scaling an asset' },
      { id: 'cs-revenue-leaks',                         text: 'identify revenue leaks' },
      { id: 'cs-high-performance-culture',              text: 'institutionalise high-performance culture' },
      { id: 'cs-your-experience-is-impressive',          text: 'your experience is impressive' },
    ],
  },

  // ── Business-Lesson Parasitism ────────────────────────────────────────────
  // The genre of posts that hijack unrelated life events (flights, pets, kids,
  // meals, celebrities) and funnel them into B2B sales or leadership lessons.
  // Distinct from personal-life-fables (which targets the "taught me" opener
  // attached to a specific person/event) — this targets the explicit pivot to
  // "B2B sales / leadership / growth" phrasing at the end.
  // Widely mocked online as a distinct recurring trope.
  {
    id: 'business-lesson-parasitism',
    emoji: '🪱',
    label: 'Business-Lesson Parasitism',
    description: 'Random life events pivoted into B2B sales or leadership lessons.',
    terms: [
      { id: 'blp-taught-me-about-b2b-sales',       text: 'taught me about b2b sales' },
      { id: 'blp-learned-about-b2b-sales',         text: 'learned about b2b sales' },
      { id: 'blp-taught-me-about-sales',           text: 'taught me about sales leadership' },
      { id: 'blp-moral-of-the-story',              text: 'moral of the story:' },
      { id: 'blp-the-moral-of-the-story-is',       text: 'the moral of the story is' },
      { id: 'blp-closed-won-status',               text: 'closed won status' },
    ],
  },

  // ── Milestone Theater ────────────────────────────────────────────────────
  // Speaker slots, committee appointments, award announcements, and departure
  // love-letters that are really just credential flexes in ceremony wrappers.
  // These are NOT humble enough for humble-brags — they're full narcissism.
  // Widely documented by Talked About Marketing, Daniel Rosehill, and others.
  {
    id: 'milestone-theater',
    emoji: '🎖️',
    label: 'Milestone Theater',
    description: 'Speaker/award/committee flexes, departure love-letters, and work-anniversary ceremonies.',
    terms: [
      { id: 'mt-delighted-and-grateful-to-count-myself', text: 'delighted and grateful to count myself among' },
      { id: 'mt-working-alongside-their-talented-team',  text: 'working alongside their talented team was truly' },
      { id: 'mt-my-next-journey-is-at',                  text: 'my next journey is at' },
      { id: 'mt-team-of-superstars',                     text: 'team of superstars' },
      { id: 'mt-very-proud-to-be-part-of-an-amazing-committee', text: 'proud to be part of an amazing committee' },
      { id: 'mt-id-like-to-take-this-opportunity-to-recognise', text: "i'd like to take this opportunity to recognise" },
      { id: 'mt-id-like-to-take-this-opportunity-to-recognize',  text: "i'd like to take this opportunity to recognize" },
    ],
  },

  // ── Fake-Dialogue Pitch ───────────────────────────────────────────────────
  // Scripted "boss vs. employee" or "customer vs. me" dialogues that culminate
  // in a product reveal. Distinct from numbers-theater (revenue claims) and
  // founder-theater (startup performance) — this targets the dramatized-pitch
  // genre specifically. All terms are multi-word, near-zero false-positive risk.
  {
    id: 'fake-dialogue-pitch',
    emoji: '🎬',
    label: 'Fake-Dialogue Pitch',
    description: 'Scripted boss/employee/customer dialogues that reveal a product as the hero.',
    terms: [
      { id: 'fdp-start-getting-the-roi-out-of',     text: 'start getting the roi out of' },
      { id: 'fdp-and-luckily-there-is',             text: 'and luckily, there is' },
      { id: 'fdp-amp-luckily-there-is',             text: '& luckily there is' },
      { id: 'fdp-where-have-you-guys-been',         text: 'where have you guys been all this time' },
      { id: 'fdp-all-their-reactions-are-the-same', text: 'all their reactions are the same' },
    ],
  },

];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the array of enabled term IDs for a given category.
 * Always returns a clean array; never throws on malformed storage.
 * Silently drops any IDs that no longer exist in the current catalog —
 * prevents stale storage entries from inflating counts after a catalog update.
 *
 * @param {{ presetState?: object }} settings
 * @param {string} categoryId
 * @returns {string[]}
 */
function getPresetEnabledIds(settings, categoryId) {
  var state = settings && settings.presetState;
  if (!state || typeof state !== 'object') return [];
  var raw = state[categoryId];
  if (!Array.isArray(raw)) return [];

  // Build a set of valid IDs for this category from the live catalog.
  var validIds = {};
  for (var c = 0; c < HU_PRESETS.length; c++) {
    if (HU_PRESETS[c].id === categoryId) {
      var terms = HU_PRESETS[c].terms;
      for (var k = 0; k < terms.length; k++) {
        validIds[terms[k].id] = true;
      }
      break;
    }
  }

  // Deduplicate, type-check, and drop stale IDs in one pass.
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var id = raw[i];
    if (typeof id === 'string' && validIds[id] && !seen[id]) {
      seen[id] = true;
      out.push(id);
    }
  }
  return out;
}

/**
 * Return the flat list of raw term strings for all enabled preset terms.
 *
 * @param {{ presetState?: object }} settings
 * @returns {string[]}
 */
function getEnabledPresetTerms(settings) {
  var terms = [];
  for (var i = 0; i < HU_PRESETS.length; i++) {
    var category = HU_PRESETS[i];
    var enabledIds = getPresetEnabledIds(settings, category.id);
    for (var j = 0; j < category.terms.length; j++) {
      var term = category.terms[j];
      if (enabledIds.indexOf(term.id) !== -1) {
        terms.push(term.text);
      }
    }
  }
  return terms;
}

// ── Slop Sensitivity Levels ───────────────────────────────────────────────────
// Cumulative: each level includes all terms from levels below it.
// categoryIds: preset category IDs whose terms are activated at this level.
// structural:  named structural detectors fired at this level (broetry, math-bold).

// Slop slider levels — each level extends the previous one (cumulative).
//
// Weighting philosophy (2026-05-12 retune):
//   L1 Polite: only the worst spam/scam + AI prompt residue. False-positive
//     risk near zero. Most users will say "yes, obvious slop."
//   L2 Normal: + engagement bait + AI-written tells. Posts engineered for
//     engagement or written by AI. Still no heuristic scorer.
//   L3 Strict: + clearer slop patterns. Heuristic scorer turns on at a HIGH
//     threshold — needs 3+ strong signals (emoji + CTA + broetry etc.).
//   L4 Scorched Earth: + broad slop clichés (humble brags, motivational
//     platitudes, corporate/consultant speak). Heuristic threshold tightens
//     but still requires 2 strong signals + 1 medium.
//
// Heuristic scorer signals (see scorePostForAiSlop): emoji density (≤30),
// hashtag-block-at-end (25), broetry (25), CTA phrases (≤30), brochure
// lexicon density (≤20). Sum capped at 100. Threshold 0 = scorer off.

var HU_SLOP_LEVELS = [
  {
    level:       0,
    label:       'Off',
    emoji:       '⬜',
    subtitle:    'Slider is off — no extra filtering.',
    categoryIds: [],
    structural:  [],
    heuristicThreshold: 0,
  },
  {
    level:       1,
    label:       'Polite',
    emoji:       '😌',
    subtitle:    'Scam signals (lead magnets, fake recruiter pitches, crypto, franchise / MLM), inbox cold pitches, and AI prompt residue. Plus extreme sentence-per-line broetry.',
    categoryIds: ['lead-magnets', 'job-scam-signals', 'crypto-hype',
                  'ai-prompt-artifacts',
                  'recruiter-spam', 'franchise-spam', 'inbox-cold-pitches'],
    structural:  ['sentence-ladder'],
    heuristicThreshold: 0,
  },
  {
    level:       2,
    label:       'Normal',
    emoji:       '😐',
    subtitle:    'Adds engagement bait, AI hype, AI voice tells, fake-dialogue pitches, and number bait. Detects extended broetry, micro-listicles, em-dash pacing, brochure language, and three-beat arcs. Heuristic scorer activates at a high threshold.',
    categoryIds: ['lead-magnets', 'job-scam-signals', 'crypto-hype',
                  'ai-prompt-artifacts',
                  'recruiter-spam', 'franchise-spam', 'inbox-cold-pitches',
                  'engagement-bait', 'ai-hype', 'ai-slop-voice',
                  'fake-dialogue-pitch', 'numbers-theater'],
    structural:  ['sentence-ladder', 'extended-broetry', 'numbered-micro-listicle',
                  'em-dash-pacing', 'brochure-lexicon-cluster', 'three-beat-arc'],
    heuristicThreshold: 80,
  },
  {
    level:       3,
    label:       'Strict',
    emoji:       '😤',
    subtitle:    'Adds hustle-culture clichés, performative openers, AI prose tells, founder theater, milestone theater, and low-signal comments. Detects broetry, emoji-bullet stacks, ellipsis pacing, triple-enumeration stacks, number hooks, and title-case heading stacks. Heuristic threshold tightens.',
    categoryIds: ['lead-magnets', 'job-scam-signals', 'crypto-hype',
                  'ai-prompt-artifacts',
                  'recruiter-spam', 'franchise-spam', 'inbox-cold-pitches',
                  'engagement-bait', 'ai-hype', 'ai-slop-voice',
                  'fake-dialogue-pitch', 'numbers-theater',
                  'hustle-culture', 'performative-openers', 'ai-prose-tells',
                  'founder-theater', 'milestone-theater', 'low-signal-comments'],
    structural:  ['sentence-ladder', 'extended-broetry', 'numbered-micro-listicle',
                  'em-dash-pacing', 'brochure-lexicon-cluster', 'three-beat-arc',
                  'broetry', 'emoji-bullet-stack', 'ellipsis-pacing',
                  'micro-paragraph-cascade',
                  'triple-enumeration-stack', 'number-hook-opener',
                  'title-case-heading-stack', 'anaphoric-fragment-stack'],
    heuristicThreshold: 65,
  },
  {
    level:       4,
    label:       'Scorched Earth',
    emoji:       '🔥',
    subtitle:    'Adds humble brags, personal-life fables, trauma bait, business-lesson parasitism, corporate / consultant speak, thought-leader fishing, and motivational platitudes. Detects inline reframes, contrastive pairs, hook/body/CTA rhythm, rhetorical hinge reveals, math-bold Unicode, and more. Heuristic threshold drops to its loosest.',
    categoryIds: ['lead-magnets', 'job-scam-signals', 'crypto-hype',
                  'ai-prompt-artifacts',
                  'recruiter-spam', 'franchise-spam', 'inbox-cold-pitches',
                  'engagement-bait', 'ai-hype', 'ai-slop-voice',
                  'fake-dialogue-pitch', 'numbers-theater',
                  'hustle-culture', 'performative-openers', 'ai-prose-tells',
                  'founder-theater', 'milestone-theater', 'low-signal-comments',
                  'humble-brags', 'personal-life-fables', 'trauma-bait',
                  'business-lesson-parasitism',
                  'corporate-speak', 'consultant-speak',
                  'thought-leader-fishing', 'motivational-platitudes'],
    structural:  ['sentence-ladder', 'extended-broetry', 'numbered-micro-listicle',
                  'em-dash-pacing', 'brochure-lexicon-cluster', 'three-beat-arc',
                  'broetry', 'emoji-bullet-stack', 'ellipsis-pacing',
                  'micro-paragraph-cascade',
                  'triple-enumeration-stack', 'number-hook-opener',
                  'title-case-heading-stack', 'anaphoric-fragment-stack',
                  'inline-not-about-reframe-stack', 'contrastive-reframe-stack',
                  'same-stem-antithesis-pair', 'some-others-binary-pair',
                  'compressed-inversion-payoff', 'ai-contrastive-pair',
                  'hook-body-cta', 'question-fragment-opener',
                  'rhetorical-hinge-reveal', 'math-bold'],
    heuristicThreshold: 50,
  },
];

function getSlopHeuristicThreshold(level) {
  var i;
  for (i = 0; i < HU_SLOP_LEVELS.length; i++) {
    if (HU_SLOP_LEVELS[i].level === level) {
      return typeof HU_SLOP_LEVELS[i].heuristicThreshold === 'number'
        ? HU_SLOP_LEVELS[i].heuristicThreshold
        : 0;
    }
  }
  return 0;
}

function getSliderManagedTermIdsAtLevel(level) {
  if (typeof level !== 'number' || level <= 0 || level > 4) return [];

  var cfg = null;
  var i;
  for (i = 0; i < HU_SLOP_LEVELS.length; i++) {
    if (HU_SLOP_LEVELS[i].level === level) {
      cfg = HU_SLOP_LEVELS[i];
      break;
    }
  }
  if (!cfg || !Array.isArray(cfg.categoryIds) || !cfg.categoryIds.length) return [];

  var catIdSet = {};
  for (i = 0; i < cfg.categoryIds.length; i++) {
    catIdSet[cfg.categoryIds[i]] = true;
  }

  var out = [];
  var seen = {};
  for (i = 0; i < HU_PRESETS.length; i++) {
    var cat = HU_PRESETS[i];
    if (!catIdSet[cat.id]) continue;
    for (var j = 0; j < cat.terms.length; j++) {
      var termId = cat.terms[j].id;
      if (!termId || seen[termId]) continue;
      seen[termId] = true;
      out.push(termId);
    }
  }
  return out;
}

/**
 * Return the flat list of raw term strings for the current slop sensitivity level.
 * Only includes terms NOT already enabled in the user's preset state, to avoid
 * sending duplicates to compileBlacklist().
 *
 * @param {{ slopSensitivityLevel?: number, presetState?: object }} settings
 * @returns {string[]}
 */
function getSlopSensitivityTerms(settings) {
  var level = (settings && typeof settings.slopSensitivityLevel === 'number')
    ? settings.slopSensitivityLevel : 0;
  if (level <= 0 || level > 4) return [];

  var levelConfig = null;
  var i;
  for (i = 0; i < HU_SLOP_LEVELS.length; i++) {
    if (HU_SLOP_LEVELS[i].level === level) { levelConfig = HU_SLOP_LEVELS[i]; break; }
  }
  if (!levelConfig || !levelConfig.categoryIds.length) return [];

  // Build set of already-enabled term texts (normalized) to avoid duplicates.
  var alreadyEnabled = {};
  var enabledTermTexts = getEnabledPresetTerms(settings);
  var j;
  for (j = 0; j < enabledTermTexts.length; j++) {
    var n = normalizeText(enabledTermTexts[j]);
    if (n) alreadyEnabled[n] = true;
  }
  // Also include custom blacklist terms in dedup.
  var custom = (settings && Array.isArray(settings.blacklist)) ? settings.blacklist : [];
  for (j = 0; j < custom.length; j++) {
    var nc = normalizeText(custom[j]);
    if (nc) alreadyEnabled[nc] = true;
  }

  var catIdSet = {};
  for (i = 0; i < levelConfig.categoryIds.length; i++) {
    catIdSet[levelConfig.categoryIds[i]] = true;
  }

  var out = [];
  var seenNorm = {};
  for (i = 0; i < HU_PRESETS.length; i++) {
    var cat = HU_PRESETS[i];
    if (!catIdSet[cat.id]) continue;
    for (j = 0; j < cat.terms.length; j++) {
      var term = cat.terms[j];
      var norm = normalizeText(term.text);
      if (!norm || seenNorm[norm]) continue;
      seenNorm[norm] = true;
      if (alreadyEnabled[norm]) continue;
      out.push(term.text);
    }
  }
  return out;
}

/**
 * Return a descriptor object for displaying slop sensitivity in the popup UI.
 *
 * @param {number} level  0–4
 * @param {{ slopSensitivityLevel?: number, blacklist?: string[], presetState?: object }} settings
 * @returns {{ label: string, emoji: string, subtitle: string, categoryCount: number,
 *             curatedTermCount: number, netNewTermCount: number,
 *             structuralCount: number, chipLabels: string[] }}
 */
function getSlopSensitivityDescriptor(level, settings) {
  var cfg = null;
  var i;
  for (i = 0; i < HU_SLOP_LEVELS.length; i++) {
    if (HU_SLOP_LEVELS[i].level === level) { cfg = HU_SLOP_LEVELS[i]; break; }
  }
  if (!cfg) cfg = HU_SLOP_LEVELS[0];

  var catIdSet = {};
  for (i = 0; i < cfg.categoryIds.length; i++) {
    catIdSet[cfg.categoryIds[i]] = true;
  }

  // Count curated terms and build chip labels (category labels for this level).
  var curatedTermCount = 0;
  var chipLabels = [];
  for (i = 0; i < HU_PRESETS.length; i++) {
    var cat = HU_PRESETS[i];
    if (!catIdSet[cat.id]) continue;
    curatedTermCount += cat.terms.length;
    chipLabels.push((cat.emoji ? cat.emoji + '\u00A0' : '') + cat.label);
  }

  // Net-new: terms not already in blacklist + presetState
  var netNewTerms = getSlopSensitivityTerms(Object.assign({}, settings, { slopSensitivityLevel: level }));

  return {
    label:           cfg.label,
    emoji:           cfg.emoji,
    subtitle:        cfg.subtitle,
    categoryCount:   cfg.categoryIds.length,
    curatedTermCount: curatedTermCount,
    netNewTermCount: netNewTerms.length,
    structuralCount: cfg.structural.length,
    chipLabels:      chipLabels,
  };
}

/**
 * Merge user's custom blacklist with all enabled preset terms, deduplicating
 * by normalized value. This is the list passed to compileBlacklist().
 *
 * @param {{ blacklist?: string[], presetState?: object }} settings
 * @returns {string[]}
 */
function getEffectiveBlacklist(settings) {
  var custom = (settings && Array.isArray(settings.blacklist))
    ? settings.blacklist
    : [];
  var preset = getEnabledPresetTerms(settings);

  var all = custom.concat(preset);
  var seen = new Set();
  var deduped = [];
  for (var i = 0; i < all.length; i++) {
    var raw = all[i];
    var normalized = normalizeText(raw);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(raw);
    }
  }
  return deduped;
}
