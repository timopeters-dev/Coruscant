import {
  createValuationEstimateHandler,
  createValuationPreviewHandler,
} from "./handlers";

export const dynamic = "force-dynamic";

export const GET = createValuationPreviewHandler();
export const POST = createValuationEstimateHandler();
