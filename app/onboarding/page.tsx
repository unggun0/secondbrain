"use client";
import { createBrowserClient } from "@supabase/ssr";import DigitalLoomBackground from "@/components/ui/digital-loom-background";
import { useState } from "react";
import { useRouter } from "next/navigation";

const PURPOSES = [
"💡 Idea Organization", "📚 Learning & Study", "💼 Work & Projects", "🎯 Goals & Planning", "✍️ Writing & Creation", "🧘 Thoughts & Emotional Reflection",
];

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [brainName, setBrainName] = useState("");
  const [selectedPurposes, setSelectedPurposes] = useState<string[]>([]);
  const router = useRouter();

  const togglePurpose = (p: string) => {
    setSelectedPurposes((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  const handleFinish = async () => {
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const { data: { user } } = await supabase.auth.getUser();
      console.log("✅ 온보딩 완료 user:", user?.id);

      if (user) {
        const { error } = await supabase.from("profiles").upsert({
          id: user.id,
          onboarded: true,
          brain_name: brainName,
          purposes: selectedPurposes,
        });
        console.log("✅ profiles 저장 error:", error);
      }
    } catch (e) {
      console.error("❌ 온보딩 저장 실패:", e);
    }

    router.push("/dashboard");
  };

  return (
    <DigitalLoomBackground>
      <div className="w-full max-w-lg mx-auto px-4">
        <div
          className="backdrop-blur-sm bg-white/5 border border-white/10 rounded-3xl p-12 flex flex-col items-center"
          style={{ boxShadow: "0 0 40px rgba(255,255,255,0.05), 0 25px 50px rgba(0,0,0,0.5)" }}
        >
          <div className="flex gap-2 mb-10">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-1 w-8 rounded-full transition-all ${s <= step ? "bg-white" : "bg-white/20"}`}
              />
            ))}
          </div>

          {step === 1 && (
            <div className="w-full flex flex-col items-center">
              <h1 className="text-3xl font-black text-white tracking-tighter mb-3 text-center">
                Your Brain, Your Name
              </h1>
              <p className="text-gray-500 text-sm text-center mb-8">
                What do you want to call your Second Brain?
              </p>
              <input
                type="text"
                value={brainName}
                onChange={(e) => setBrainName(e.target.value)}
                placeholder="e.g. My Creative Brain"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-gray-600 text-sm outline-none focus:border-white/30 transition-all text-center mb-8"
              />
              <button
                onClick={() => brainName.trim() && setStep(2)}
                className="w-full py-4 rounded-2xl font-semibold text-white transition-all"
                style={{
                  background: brainName.trim() ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                Continue →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="w-full flex flex-col items-center">
              <h1 className="text-3xl font-black text-white tracking-tighter mb-3 text-center">
                What's Your Brain For?
              </h1>
              <p className="text-gray-500 text-sm text-center mb-8">
                Select all that apply
              </p>
              <div className="grid grid-cols-2 gap-3 w-full mb-8">
                {PURPOSES.map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePurpose(p)}
                    className={`p-4 rounded-2xl border text-sm text-white transition-all ${
                      selectedPurposes.includes(p)
                        ? "bg-white/15 border-white/30"
                        : "bg-white/5 border-white/10"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={handleFinish}
                className="w-full py-4 rounded-2xl font-semibold text-white transition-all"
                style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)" }}
              >
                Enter My Brain 🧠
              </button>
            </div>
          )}
        </div>
      </div>
    </DigitalLoomBackground>
  );
}