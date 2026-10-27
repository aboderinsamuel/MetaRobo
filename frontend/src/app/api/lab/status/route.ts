import { MODEL_ID, aiEnabled } from "@/lib/lab/ai";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ai: aiEnabled(), model: aiEnabled() ? MODEL_ID : null });
}
