// PHASE 2 verification script: Super App Home, Navigation & Wallet
import { isActiveOrderStatus } from '../lib/types';
import { translations } from '../lib/i18n';

let passed = 0;
let failed = 0;

function check(desc: string, condition: boolean, extra?: string) {
  if (condition) {
    console.log(`[PASS] ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${desc}${extra ? ` - ${extra}` : ''}`);
    failed++;
  }
}

// 1. Check isActiveOrderStatus helper
check('searching is active', isActiveOrderStatus('searching') === true);
check('scheduled is active', isActiveOrderStatus('scheduled') === true);
check('accepted is active', isActiveOrderStatus('accepted') === true);
check('picked is active', isActiveOrderStatus('picked') === true);
check('delivered is inactive', isActiveOrderStatus('delivered') === false);
check('cancelled is inactive', isActiveOrderStatus('cancelled') === false);
check('null status is inactive', isActiveOrderStatus(null) === false);
check('unknown status is inactive', isActiveOrderStatus('refunded') === false);

// 2. Check i18n keys in both AR and FR
const ar = translations.ar as unknown as Record<string, string>;
const fr = translations.fr as unknown as Record<string, string>;

const requiredKeys = [
  'superAppWelcome',
  'superAppLocation',
  'superAppServices',
  'taxiServiceTitle',
  'taxiServiceDesc',
  'cargoServiceTitle',
  'cargoServiceDesc',
  'craftServiceTitle',
  'craftServiceDesc',
  'shoppingServiceTitle',
  'shoppingServiceDesc',
  'activeOrderTitle',
  'trackActiveOrder',
  'quickActions',
  'quickMyOrders',
  'quickCraft',
  'quickOffers',
  'myWallet',
  'walletTitle',
  'walletCashNoticeTitle',
  'walletCashNoticeDesc',
  'walletBalanceLabel',
  'walletCurrency',
  'walletComingSoonBadge',
  'backToHome',
];

for (const key of requiredKeys) {
  check(`ar translation exists: ${key}`, typeof ar[key] === 'string' && ar[key].length > 0);
  check(`fr translation exists: ${key}`, typeof fr[key] === 'string' && fr[key].length > 0);
}

console.log(`\nPHASE 2 RESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}