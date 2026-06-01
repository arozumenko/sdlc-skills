# Page-Type Focus Areas

Each page type has expected patterns and common failures. When the page under
audit matches one of these types, layer these domain-specific checks on top of
the general UI/UX pass.

## Landing Pages 🚀
Look for: weak hero headline, no clear CTA above the fold, testimonials without
attribution, missing trust signals (logos, certifications), slow hero image load,
no mobile optimization, form not working.

## Homepage 🏠
Look for: unclear site purpose in first 3 seconds, broken navigation, hero image
not loading, missing search, too many competing CTAs, outdated announcements,
broken social proof section.

## Pricing 💰
Look for: unclear feature differentiation between tiers, missing FAQ, no free trial CTA,
annual/monthly toggle broken, no money-back guarantee mention, confusing enterprise pricing,
comparison table not readable on mobile.

## About ℹ️
Look for: no team section, missing company history, stock photo overuse, no press/media
kit link, missing mission statement, broken social links, no contact info.

## Contact 📬
Look for: contact form not submitting, missing required fields, no confirmation message
after submit, phone/email links broken, missing address/map, no response time expectation.

## Signup 📝
Look for: no inline password strength indicator, missing email confirmation, social login
broken, required fields not marked, captcha not working, no terms acceptance, confusing
multi-step flow.

## Checkout 💳
Look for: payment form not validating card numbers, missing CVV field, no order summary
before payment, broken coupon/promo code, address autocomplete not working, no SSL indicator,
confusing shipping options.

## Shopping Cart 🛒
Look for: quantity update not working, remove item broken, cart not persisting across
sessions, incorrect price calculation, missing shipping estimate, no promo code field,
broken checkout button.

## Product Details 🛍️
Look for: missing price, no stock indicator, broken product images, missing size guide,
no reviews section, unclear shipping info, add-to-cart not working, incomplete product specs.

## Product Catalog 📦
Look for: no filtering options, broken category navigation, inconsistent card layouts,
missing product thumbnails, no sort by price/rating, broken pagination, no "no results" state.

## Search 🔍
Look for: no results state with no guidance, slow search response, missing spell correction,
no search suggestions, empty query allowed, results not ranked by relevance.

## Search Results 📊
Look for: irrelevant top results, missing pagination or infinite scroll, no filter/sort options,
results not matching query, missing result count, sponsored results not labeled, broken links.

## News 📰
Look for: missing publication dates, no author attribution, broken image captions,
no related articles, share buttons not working, paywall without preview, missing schema markup.

## Video 🎥
Look for: video not loading, missing captions/subtitles, no playback controls, autoplay
without mute, broken thumbnail, no fallback for unsupported formats, missing transcript.

## AI Chatbots 💬
Look for: chatbot failing to respond, infinite loading states, prompt injection
vulnerabilities, missing escalation paths, bot impersonating a human, no AI disclaimer.

## Social Profiles 👤
Look for: broken avatar upload, missing follow/unfollow button, incomplete profile fields,
no privacy settings, activity feed not loading, broken external profile links.

## Social Feed 📱
Look for: infinite scroll breaking, duplicate posts, like/comment not working, missing
load-more, broken media embeds, no empty state, no timestamps, missing report/block.

## System Errors 🔴
Look for: 500 error pages without helpful content, no retry button, missing support contact,
stack trace visible in browser, session expiry with no re-login prompt.

## Legal ⚖️
Look for: outdated effective date, missing required sections (cookies, CCPA, GDPR),
legalese without plain English summary, broken internal links, no table of contents.

## Careers ⚠️
Look for: broken job listings, missing application forms, outdated postings, no EEO statement.
