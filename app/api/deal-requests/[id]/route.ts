import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDealRequest } from "@/lib/dealsApi";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const dealRequest = await getDealRequest(id);
  if (!dealRequest) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  if (dealRequest.buyerUserId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized to view this request" }, { status: 403 });
  }

  return NextResponse.json({ dealRequest });
}
