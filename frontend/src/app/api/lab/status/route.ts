import { MODEL_ID, aiEnabled } from "@/lib/lab/ai";
import { spendToday } from "@/lib/meta/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const spend = await spendToday();
  return Response.json({ ai: aiEnabled(), model: aiEnabled() ? MODEL_ID : null, spentUsd: spend.usd, budgetUsd: spend.budgetUsd });
}
