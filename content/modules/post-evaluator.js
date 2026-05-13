(function () {
  'use strict';

  var root = (typeof window !== 'undefined' && window) || globalThis;

  var ns = root.__HUCS__;
  if (!ns || !ns.modules) {
    throw new Error('OpenSlop module contracts are required before post-evaluator.js');
  }

  function createPostEvaluator(deps) {
    deps = deps || {};

    var makeHideDecision = deps.makeHideDecision;
    var buildPostContext = deps.buildPostContext;
    var isSeriousModeFunny = deps.isSeriousModeFunny;
    var isAiFiltered = deps.isAiFiltered;
    var getSliderStructuralTrigger = deps.getSliderStructuralTrigger;
    var scorePostForAiSlop = deps.scorePostForAiSlop;
    var getSlopHeuristicThreshold = deps.getSlopHeuristicThreshold;
    var getRuntimeState = deps.getRuntimeState;

    function getPostDecision(card) {
      var state = getRuntimeState();
      var ctx = buildPostContext(card);
      var rawPostText = ctx.rawPostText;

      if (state.seriousModeEnabled && isSeriousModeFunny(card)) return makeHideDecision('serious-mode');
      if (state.aiFilterEnabled && isAiFiltered(card, rawPostText)) return makeHideDecision('ai-filter');
      if (state.matcher.matches(rawPostText)) return makeHideDecision('post');

      // ── Slop sensitivity slider checks (post-only, never comments/inbox/jobs) ─
      if (state.slopSensitivityLevel > 0) {
        if (!state.slopMatcher.isEmpty && state.slopMatcher.matches(rawPostText)) {
          return makeHideDecision('ai-slop', { slopTrigger: state.slopMatcher.firstMatch(rawPostText) });
        }
        var sliderTrigger = getSliderStructuralTrigger(ctx.getStructuralPostText());
        if (sliderTrigger) return makeHideDecision('ai-slop', { slopTrigger: sliderTrigger });

        var slopThreshold = 0;
        if (typeof getSlopHeuristicThreshold === 'function') {
          slopThreshold = getSlopHeuristicThreshold(state.slopSensitivityLevel);
        }
        if (slopThreshold > 0 && scorePostForAiSlop(card) >= slopThreshold) {
          return makeHideDecision('ai-slop', { slopTrigger: 'heuristic-threshold-' + slopThreshold });
        }
      }

      return makeHideDecision('');
    }

    return {
      getPostDecision: getPostDecision,
    };
  }

  ns.modules.postEvaluator = {
    create: createPostEvaluator,
  };
})();
