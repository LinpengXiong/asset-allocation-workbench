import { Dashboard } from "./components/Dashboard";
import { LoginForm } from "./components/LoginForm";
import { isAuthorized } from "../lib/auth";
import { latestPayload } from "../lib/database";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthorized())) return <LoginForm />;
  const payload = await latestPayload();
  return <Dashboard initialPayload={payload} />;
}
