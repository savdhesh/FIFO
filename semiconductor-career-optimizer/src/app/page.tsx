import { redirect } from "next/navigation";
// The workspace is a static bundle (public/workspace) served behind the same auth middleware as the API.
export default function Home() { redirect("/workspace/index.html"); }
