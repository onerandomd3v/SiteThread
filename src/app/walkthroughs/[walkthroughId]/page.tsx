import { WalkthroughStatusCard } from "@/components/walkthrough-status-card";

export default async function WalkthroughPage({ params }: { params: Promise<{ walkthroughId: string }> }) {
  const { walkthroughId } = await params;
  return <WalkthroughStatusCard walkthroughId={walkthroughId} />;
}
