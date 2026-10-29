"use client";

// Landing-page languages: English, Japanese and Chinese (simplified), each shown in its own script.
// The choice lives in localStorage; the server always renders English and the page switches after
// hydration, so there is no mismatch.
import { useSyncExternalStore } from "react";

export const LANGS = [
  { id: "en", label: "EN", speech: "en-US" },
  { id: "ja", label: "日本語", speech: "ja-JP" },
  { id: "zh", label: "中文", speech: "zh-CN" },
] as const;
export type Lang = (typeof LANGS)[number]["id"];

const KEY = "rc-lang";
const listeners = new Set<() => void>();

function read(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.some((l) => l.id === v) ? (v as Lang) : "en";
  } catch {
    return "en";
  }
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Private mode: the switch still works for this page view.
  }
  current = lang;
  document.documentElement.lang = lang === "zh" ? "zh-Hans" : lang;
  listeners.forEach((l) => l());
}

let current: Lang | null = null;

export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (current === null) {
        current = read();
        if (current !== "en") document.documentElement.lang = current === "zh" ? "zh-Hans" : current;
      }
      return current;
    },
    () => "en",
  );
}

export const STYLE_IDS = ["studio", "anime", "ukiyoe", "inkwash", "clay", "pixel", "blueprint", "papercraft"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

interface Strings {
  nav: Record<"meta" | "loop" | "trace" | "engine" | "pricing" | "log", string>;
  launch: string;
  sound: [on: string, off: string];
  hero: {
    tag: string;
    list: string[];
    noExp: string;
    h1a: string;
    h1b: [pre: string, word: string, post: string];
    body: [pre: string, quote: string, post: string];
    start: string;
    how: string;
    listen: string;
    stop: string;
    speech: string;
  };
  styles: { kicker: string; title: string; body: string; names: Record<StyleId, string>; note: string };
}

export const STRINGS: Record<Lang, Strings> = {
  en: {
    nav: { meta: "Meta stack", loop: "The loop", trace: "Agent", engine: "Engine", pricing: "Pricing", log: "Hackathon" },
    launch: "Launch lab",
    sound: ["Sound on", "Sound off"],
    hero: {
      tag: "Your idea → real parts → 3D simulation → Robo helps you fix it",
      list: ["Ages 10 to engineer", "Simple & Pro modes", "Real part physics", "C++ → WebAssembly", "Meta Muse Spark"],
      noExp: "·· No experience needed",
      h1a: "Build a robot.",
      h1b: ["Watch it", "move", ""],
      body: [
        "Pick a robot car, arm, balancer or drone, or just say ",
        "“a robot that picks up my toys”",
        ". Press Simulate and watch it move. Robo explains what won't work and fixes it with you. Pro mode adds the graphs, maths and firmware.",
      ],
      start: "Start building",
      how: "How it works",
      listen: "Hear Robo",
      stop: "Stop",
      speech: "Hi, I'm Robo. Tell me the machine you want to build, and I'll pick real parts, wire it up, and simulate it in 3D before you buy anything.",
    },
    styles: {
      kicker: "·· Drawn by Meta Muse Image",
      title: "Robo, in every style",
      body: "One mascot, eight art styles. Generated once with Muse Image and served as plain images, so this page never spends a credit.",
      names: { studio: "Studio render", anime: "Anime", ukiyoe: "Ukiyo-e", inkwash: "Ink wash", clay: "Claymation", pixel: "Pixel art", blueprint: "Blueprint", papercraft: "Papercraft" },
      note: "muse-image-1.0 · 1024×1024 · $0.01 each",
    },
  },
  ja: {
    nav: { meta: "Metaスタック", loop: "ループ", trace: "エージェント", engine: "エンジン", pricing: "料金", log: "ハッカソン" },
    launch: "ラボを開く",
    sound: ["サウンド オン", "サウンド オフ"],
    hero: {
      tag: "アイデア → 実在の部品 → 3Dシミュレーション → Roboが改善を手伝う",
      list: ["10歳からエンジニアに", "シンプル & プロモード", "実部品の物理", "C++ → WebAssembly", "Meta Muse Spark"],
      noExp: "·· 経験は不要",
      h1a: "ロボットを作ろう。",
      h1b: ["", "動く", "のを見よう。"],
      body: [
        "ロボットカー、アーム、バランサー、ドローンを選ぶか、",
        "「おもちゃを片付けるロボット」",
        "と話しかけるだけ。シミュレートを押せば動き出します。うまくいかない点はRoboが説明し、一緒に直します。プロモードではグラフ、数式、ファームウェアも。",
      ],
      start: "作り始める",
      how: "仕組み",
      listen: "Roboの声を聞く",
      stop: "停止",
      speech: "こんにちは、Roboです。作りたい機械を教えてください。実在の部品を選んで配線し、買う前に3Dでシミュレーションします。",
    },
    styles: {
      kicker: "·· Meta Muse Image で描画",
      title: "どんなスタイルでも、Robo",
      body: "ひとつのマスコットを8つの画風で。Muse Imageで一度だけ生成し、静的な画像として配信しているので、このページはクレジットを消費しません。",
      names: { studio: "スタジオ", anime: "アニメ", ukiyoe: "浮世絵", inkwash: "水墨画", clay: "クレイアニメ", pixel: "ドット絵", blueprint: "設計図", papercraft: "ペーパークラフト" },
      note: "muse-image-1.0 · 1024×1024 · 1枚 $0.01",
    },
  },
  zh: {
    nav: { meta: "Meta 技术栈", loop: "闭环", trace: "智能体", engine: "引擎", pricing: "价格", log: "黑客松" },
    launch: "进入实验室",
    sound: ["声音 开", "声音 关"],
    hero: {
      tag: "你的想法 → 真实零件 → 3D 仿真 → Robo 帮你改进",
      list: ["10 岁就能当工程师", "简单与专业模式", "真实零件物理", "C++ → WebAssembly", "Meta Muse Spark"],
      noExp: "·· 无需经验",
      h1a: "造一个机器人。",
      h1b: ["看它", "动起来", ""],
      body: [
        "选一辆机器人小车、机械臂、平衡车或无人机，或者直接说",
        "“一个帮我收玩具的机器人”",
        "。按下仿真，看它动起来。Robo 会解释哪里行不通，并和你一起修好。专业模式还有图表、数学和固件。",
      ],
      start: "开始搭建",
      how: "工作原理",
      listen: "听 Robo 说话",
      stop: "停止",
      speech: "你好，我是 Robo。告诉我你想造的机器，我会挑选真实零件、接好线路，并在你购买之前进行 3D 仿真。",
    },
    styles: {
      kicker: "·· 由 Meta Muse Image 绘制",
      title: "百变风格的 Robo",
      body: "一个吉祥物，八种画风。用 Muse Image 只生成一次，以静态图片提供，所以这个页面不会消耗任何额度。",
      names: { studio: "影棚渲染", anime: "动漫", ukiyoe: "浮世绘", inkwash: "水墨", clay: "黏土动画", pixel: "像素画", blueprint: "蓝图", papercraft: "纸艺" },
      note: "muse-image-1.0 · 1024×1024 · 每张 $0.01",
    },
  },
};

export function useStrings(): Strings {
  return STRINGS[useLang()];
}
