import { DashboardClient } from "../../../components/dashboard-client";


export default async function NeoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolved = await params;
  return <DashboardClient standaloneNeoId={resolved.id} />;
}
