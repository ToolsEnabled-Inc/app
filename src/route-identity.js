/* ARE THESE TWO ROUTES THE SAME VIEW?
 *
 * Pulled out of src/main.js so it can actually be tested: main.js imports CSS
 * and is only loadable through vite, which is why every existing test of it
 * reads the source as text rather than running it. Pure route logic belongs
 * where it can be exercised, the way src/setup-profile.js holds resumeStep and
 * stepAfter for the setup flow.
 *
 * WHY THE QUESTION EXISTS. render() is not only called for navigation -- a
 * background probe answering calls it too -- and swapView always builds a new
 * view and destroys the old one. Without this predicate, a probe landing while
 * somebody was half way through setup rebuilt what they were using.
 */

/* The same STOP is not enough. makeView reads comp, agent, example and query
   off the route, so two routes differing in any of them build different views
   and must never be treated as one -- pressing through to a second agent while
   still being shown the first is a far worse bug than the one this prevents.
   Anything makeView starts consuming belongs in here on the same commit. */
export function sameRoute(a, b) {
  if (!a || !b || a.name !== b.name) return false
  return a.comp === b.comp
    && a.agent === b.agent
    && a.example === b.example
    && a.query === b.query
}
