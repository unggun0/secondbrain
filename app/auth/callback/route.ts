import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  console.log("✅ callback 실행됨, code:", code);

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    console.log("❌ exchange error:", error);

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      console.log("✅ user:", user?.id);

      if (user) {
        // profiles 확인
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarded")
          .eq("id", user.id)
          .single();

        console.log("✅ profile:", profile);

        if (profile === null) {
          // 신규회원 → profiles 자동 생성
          await supabase.from("profiles").insert({
            id: user.id,
            onboarded: false,
          });
          return NextResponse.redirect(new URL("/onboarding", requestUrl.origin));
        }

        if (profile.onboarded) {
          // 기존회원 → 대시보드
          return NextResponse.redirect(new URL("/dashboard", requestUrl.origin));
        } else {
          // 온보딩 미완료 → 온보딩
          return NextResponse.redirect(new URL("/onboarding", requestUrl.origin));
        }
      }
    }
  }

  console.log("❌ 실패 → 랜딩페이지로");
  return NextResponse.redirect(new URL("/", requestUrl.origin));
}