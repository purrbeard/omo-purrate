// Presentation content for scripts/readme-media.mjs: demo workspaces, the sidebar's past sessions, the skill
// catalog and the FAKE_OMO_DEMO scenes that tests/fixtures/fake-omo.mjs plays. None of it ships in the app.
import path from "node:path";

export const WORKSPACES = ["acme-shop", "payments-api", "omo-ui-macosapp", "docs-site"];

/** Session names the capture script sets after sending, as omo names sessions from their first request. */
export const NAMES = {
  checkout: "Ship the checkout flow",
  migrate: "Orders table migration",
  chips: "Move the API client to fetch",
  korean: "Apple Pay 결제 추가",
};

export const PROMPTS = {
  checkout: "Ship the new checkout flow: a Stripe payment step, an order summary and e2e tests",
  migrate: "Add an orders table migration and run it against staging",
  chips: "Migrate the API client from axios to fetch",
  korean: "결제 단계에 Apple Pay를 추가하고 e2e 테스트까지 붙여줘",
  side: "what's left before we can merge?",
};

/** Text the scenes stream last; the capture script waits for it before taking a screenshot. */
export const SETTLED = {
  checkout: "as soon as both lanes land.",
  migrate: "GROUP BY status;",
  chips: "verified by its own tests.",
  korean: "시나리오를 추가하겠습니다.",
  side: "nothing is ready to merge yet.",
};

const HOUR = 3600;
const DAY = 24 * HOUR;
const SEEDS = [
  ["acme-shop", "Fix the flaky cart totals test", 42 * 60],
  ["acme-shop", "Add Apple Pay to the payment step", DAY + 2 * HOUR],
  ["payments-api", "Rotate the webhook signing secret", 3 * HOUR],
  ["payments-api", "Retry failed payouts with exponential backoff", 2 * DAY],
  ["omo-ui-macosapp", "Polish the side chat panel", 5 * HOUR],
  ["omo-ui-macosapp", "Package the DMG for the 0.1 release", DAY + 6 * HOUR],
  ["docs-site", "Rewrite the getting-started guide", 3 * DAY],
];

/**
 * FAKE_OMO_SEED_THREADS entries: past sessions the sidebar lists beside the live demo sessions.
 * @param {string} root - directory that holds the demo workspaces.
 * @param {number} nowSec - capture time in seconds; ages are relative to it.
 * @returns {object[]} seed threads with demo cwds, titles and timestamps.
 */
export function seedThreads(root, nowSec) {
  return SEEDS.map(([workspace, title, age], index) => ({
    id: `demo-seed-${index + 1}`,
    cwd: path.join(root, workspace),
    preview: title,
    createdAt: nowSec - age - 600,
    updatedAt: nowSec - age,
  }));
}

const SKILLS = [
  ["ulw-loop", "Goal-driven loop: decompose the work, execute it and prove every step with evidence.", "system"],
  ["mass-ulw", "Fan dependency-ordered work out to parallel agents and merge the results.", "system"],
  ["review-work", "Gate review: manual QA on the real surface, then one independent reviewer.", "system"],
  ["frontend", "Build, style and polish web UI.", "system"],
  ["debugging", "Hypothesis-driven debugging that locks the fix with a failing test.", "system"],
  ["git-master", "Atomic commits, rebase, bisect and history questions.", "system"],
  ["browser", "Drive a real browser: forms, clicks, screenshots and QA.", "system"],
  ["plan", "Plan the requested work before touching code.", "user"],
].map(([name, description, scope]) => ({ name, description, scope, enabled: true, path: `/skills/${name}/SKILL.md` }));

/**
 * FAKE_OMO_SKILLS value: the same skill catalog for every demo workspace, in skills/list response fields.
 * @param {string} root - directory that holds the demo workspaces.
 * @returns {{ data: object[] }} the skills/list response.
 */
export function skillCatalog(root) {
  return { data: WORKSPACES.map((workspace) => ({ cwd: path.join(root, workspace), skills: SKILLS, errors: [] })) };
}

const tool = (name, args) => ({ type: "dynamicToolCall", namespace: null, tool: name, arguments: args, status: "inProgress", contentItems: null, success: null, durationMs: null });
const done = (text, durationMs) => ({ status: "completed", success: true, contentItems: [{ type: "inputText", text }], durationMs });
const added = (file, lines) => ({
  item: { type: "fileChange", changes: [{ path: file, kind: { type: "add" }, diff: `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n` }], status: "inProgress" },
  ms: 300,
  done: { status: "completed" },
});

const checkout = {
  match: PROMPTS.checkout,
  steps: [
    { reasoning: "The cart already computes totals in src/lib/cart.ts, so checkout needs three pieces: a payment step that confirms a Stripe PaymentIntent, an order summary that reads the cart, and e2e coverage for both. Payment and summary are independent; the tests need both." },
    {
      item: tool("grep", { pattern: "checkout|PaymentIntent", path: "src" }),
      ms: 350,
      done: done('src/routes/cart/index.tsx:42:  <Link to="/checkout">Checkout</Link>\nsrc/lib/cart.ts:18:export function cartTotals(items: CartItem[]): Totals {\nsrc/server/payments.ts:9:  const intent = await stripe.paymentIntents.create({', 312),
    },
    {
      item: tool("read", { path: "src/lib/cart.ts" }),
      ms: 250,
      done: done("export function cartTotals(items: CartItem[]): Totals {\n  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n  const tax = Math.round(subtotal * TAX_RATE);\n  return { subtotal, tax, total: subtotal + tax };\n}", 96),
    },
    {
      todo: [
        { name: "Discovery", tasks: [{ content: "Map the cart and routing code", status: "completed" }, { content: "Choose the Stripe integration", status: "completed" }] },
        { name: "Build", tasks: [{ content: "Payment step with Stripe Elements", status: "in_progress" }, { content: "Order summary page", status: "in_progress" }] },
        { name: "Verify", tasks: [{ content: "Playwright e2e for checkout", status: "pending" }] },
      ],
      durationMs: 14,
    },
    { goal: { objective: "Ship the checkout flow with passing e2e tests", status: "active", tokensUsed: 184200, timeUsedSeconds: 1264 } },
    { item: tool("task", { category: "deep-low", description: "Payment step with Stripe Elements", run_in_background: true }), ms: 200, done: done("Started task Payment step (task-payment, running).", 46) },
    { item: tool("task", { category: "visual-engineering", description: "Order summary page", run_in_background: true }), ms: 200, done: done("Started task Order summary (task-summary, running).", 52) },
    {
      dag: {
        name: "checkout",
        status: "running",
        nodes: [
          { id: "map", label: "Map the checkout code", prompt: "Map the cart, routing and payment code", state: "completed", task_id: "task-map" },
          { id: "payment", label: "Payment step", prompt: "Payment step with Stripe Elements", depends_on: ["map"], state: "running", task_id: "task-payment" },
          { id: "summary", label: "Order summary", prompt: "Order summary page", depends_on: ["map"], state: "running", task_id: "task-summary" },
          { id: "e2e", label: "E2E tests", prompt: "Playwright e2e for the checkout flow", depends_on: ["payment", "summary"], state: "blocked" },
        ],
      },
    },
    { dagActivity: { runId: "demo-run", nodeId: "payment", taskId: "task-payment", activity: "implementing", currentTool: "edit", turns: 6, toolCalls: 14 } },
    {
      tasks: [
        { task_id: "task-map", name: "Map the checkout code", task_summary: "Map the cart, routing and payment code", status: "completed", category: "explore", model: "openai/gpt-6.1-sol", final_response: "Totals live in src/lib/cart.ts, routes in src/routes and the Stripe server code in src/server/payments.ts.", run_stats: { runtime_ms: 48000, turns: 5, tool_calls: 11 } },
        { task_id: "task-payment", name: "Payment step", task_summary: "Payment step with Stripe Elements", status: "running", category: "deep-low", model: "anthropic/claude-fable-5", live_progress: { activity: "implementing", current_tool: "edit", turns: 6, tool_calls: 14, elapsedMs: 252000 } },
        { task_id: "task-summary", name: "Order summary", task_summary: "Order summary page", status: "running", category: "visual-engineering", model: "anthropic/claude-fable-5", live_progress: { activity: "building the summary page", current_tool: "write", turns: 4, tool_calls: 9, elapsedMs: 198000 } },
      ],
    },
    added("src/routes/checkout/payment.tsx", [
      'import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";',
      'import { useCart } from "../../lib/cart";',
      "",
      "export function PaymentStep({ onPaid }: { onPaid: (orderId: string) => void }) {",
      "  const stripe = useStripe();",
      "  const elements = useElements();",
      "  const { totals } = useCart();",
      "",
      "  async function pay() {",
      "    if (!stripe || !elements) return;",
      '    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });',
      "    if (error) throw error;",
      "    onPaid(paymentIntent.metadata.orderId);",
      "  }",
      "",
      "  return <PaymentForm total={totals.total} onSubmit={pay}><PaymentElement /></PaymentForm>;",
      "}",
    ]),
    {
      say: "Discovery is done, and two lanes are building in parallel:\n\n| Lane | Agent | State |\n| --- | --- | --- |\n| Payment step | deep-low · Claude Fable 5 | editing `payment.tsx` |\n| Order summary | visual-engineering · Claude Fable 5 | building the summary page |\n| E2E tests | waits for both lanes | blocked |\n\nI'll wire `/checkout/payment` and `/checkout/summary` into the router and start the Playwright suite as soon as both lanes land.",
      chunks: 10,
      chunkMs: 50,
    },
    { hold: true },
  ],
};

const migrate = {
  match: PROMPTS.migrate,
  steps: [
    { reasoning: "An orders table needs the customer, the total in cents, a status and timestamps. I'll write the migration, run it against staging (that needs approval), then ask before backfilling the legacy invoices." },
    added("migrations/20261002_create_orders.sql", [
      "CREATE TABLE orders (",
      "  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
      "  customer_id uuid NOT NULL REFERENCES customers (id),",
      "  total_cents integer NOT NULL CHECK (total_cents >= 0),",
      "  status      text NOT NULL DEFAULT 'pending',",
      "  created_at  timestamptz NOT NULL DEFAULT now(),",
      "  updated_at  timestamptz NOT NULL DEFAULT now()",
      ");",
      "",
      "CREATE INDEX orders_customer_id_idx ON orders (customer_id);",
      "CREATE INDEX orders_status_idx ON orders (status);",
    ]),
    {
      command: {
        command: "npm run db:migrate -- --env staging",
        cwd: "~/code/payments-api",
        approval: { reason: "Permission required: bash" },
        output: "> payments-api@2.4.0 db:migrate\n> knex migrate:latest --env staging\n\nUsing environment: staging\nBatch 12 run: 1 migrations\n  ✔ 20261002_create_orders.sql",
        exitCode: 0,
        ms: 900,
      },
    },
    {
      question: {
        header: "Backfill",
        question: "Backfill orders from the 48,210 legacy invoices now?",
        options: [
          { label: "Backfill now", description: "About 2 minutes; writes to staging only" },
          { label: "Schedule for 02:00 UTC", description: "Runs tonight as a background job" },
        ],
      },
    },
    {
      say: "## Migration applied\n\nThe `orders` table now exists on **staging** (batch 12), with indexes on `customer_id` and `status`.\n\n| Step | Result |\n| --- | --- |\n| Migration | `20261002_create_orders.sql` ✔ |\n| Backfill | {{answer}} |\n| Production | not touched |\n\nCheck it with:\n\n```sql\nSELECT status, count(*) FROM orders GROUP BY status;\n```",
      chunks: 10,
      chunkMs: 40,
    },
  ],
};

const chips = {
  match: PROMPTS.chips,
  steps: [
    { reasoning: "14 modules import the axios client. A goal loop tracks the migration, and mass-ulw can run one lane per module because they share no state." },
    { say: "Starting the loop with one lane per module: 14 call sites, each migrated to `fetch` behind the existing `apiClient` interface and verified by its own tests.", chunks: 6, chunkMs: 40 },
  ],
};

const korean = {
  match: PROMPTS.korean,
  steps: [
    { reasoning: "결제 단계가 이미 Stripe Payment Element를 쓰고 있으니 Apple Pay는 Express Checkout Element로 붙일 수 있습니다. 도메인 검증 파일과 e2e 시나리오가 필요합니다." },
    { item: tool("grep", { pattern: "PaymentElement", path: "src" }), ms: 300, done: done("src/routes/checkout/payment.tsx:1:import { PaymentElement, useElements, useStripe } from \"@stripe/react-stripe-js\";", 208) },
    {
      todo: [
        { name: "조사", tasks: [{ content: "Stripe 설정 확인", status: "completed" }, { content: "도메인 검증 파일 확인", status: "completed" }] },
        { name: "구현", tasks: [{ content: "Express Checkout Element 추가", status: "in_progress" }, { content: "결제 실패 시 카드 결제로 전환", status: "pending" }] },
        { name: "검증", tasks: [{ content: "Playwright e2e에 Apple Pay 시나리오 추가", status: "pending" }] },
      ],
      durationMs: 11,
    },
    { goal: { objective: "Apple Pay 결제와 e2e 테스트까지 완료", status: "active", tokensUsed: 61800, timeUsedSeconds: 412 } },
    {
      say: "## 진행 상황\n\n조사는 끝났고 결제 단계에 `ExpressCheckoutElement`를 붙이는 중입니다.\n\n- 도메인 검증 파일은 이미 `public/.well-known/`에 있습니다.\n- Apple Pay를 쓸 수 없는 브라우저에서는 기존 카드 결제로 돌아갑니다.\n\n다음으로 Playwright e2e에 Apple Pay 시나리오를 추가하겠습니다.",
      chunks: 8,
      chunkMs: 50,
    },
    { hold: true },
  ],
};

/** The FAKE_OMO_DEMO file contents. */
export const DEMO = {
  session: { model: "claude-fable-5", modelProvider: "anthropic" },
  models: [
    { id: "anthropic/claude-fable-5", model: "claude-fable-5", displayName: "Claude Fable 5", isDefault: true },
    { id: "openai/gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", isDefault: false },
  ],
  scenes: [checkout, migrate, chips, korean],
  sideAnswers: [
    {
      match: PROMPTS.side,
      reply: "Two lanes are still running: the payment step and the order summary. The Playwright e2e suite starts once both land, and the /checkout routes still need wiring, so nothing is ready to merge yet.",
      chunks: 12,
      chunkMs: 110,
    },
  ],
};
