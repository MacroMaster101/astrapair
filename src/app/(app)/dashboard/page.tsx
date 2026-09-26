import type { Metadata } from "next";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProfile } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard · AstraPair" };

export default async function DashboardPage() {
  const profile = await getProfile();

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hello{profile.display_name ? `, ${profile.display_name}` : ""}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Your birth chart</CardTitle>
          <CardDescription>
            Birth profiles and natal charts are coming next. You&apos;ll add
            your birth date, time, and place here.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
