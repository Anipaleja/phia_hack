const ShoppingAgentService = require('./dist/services/shoppingAgentService').default;
const AnalyticsService = require('./dist/services/analyticsService').default;
const ShareService = require('./dist/services/shareService').default;

(async () => {
  const prompt = 'JFK Jr spring outfit in NYC';

  const first = await ShoppingAgentService.buildOutfit(prompt, 'all');
  const second = await ShoppingAgentService.buildOutfit(prompt, 'all');

  await new Promise((resolve) => setTimeout(resolve, 50));

  const share = ShareService.getSharedOutfit(first.shareId);
  const summary = AnalyticsService.getSummary();

  const checks = {
    firstHasVariants: Array.isArray(first.variants) && first.variants.length > 0,
    firstHasRecommendations:
      Array.isArray(first.recommendations?.items) && first.recommendations.items.length > 0,
    firstHasShareId: !!first.shareId,
    secondIsCached: second.cached === true,
    sharedRoundtrip: !!(share && share.outfit && share.outfit.shareId === first.shareId),
    analyticsTopPrompt: Array.isArray(summary.topPrompts) && summary.topPrompts.length > 0,
    analyticsHasCacheRate: typeof summary.cacheHitRate === 'number',
    analyticsHasLatency: typeof summary.avgLatencyMs === 'number',
    analyticsHasTopVibes: Array.isArray(summary.topVibes),
  };

  console.log('SERVICE_E2E_CHECKS', JSON.stringify(checks, null, 2));

  const ok = Object.values(checks).every(Boolean);
  if (!ok) {
    process.exit(1);
  }

  console.log('SERVICE_E2E_RESULT: PASS');
})();
