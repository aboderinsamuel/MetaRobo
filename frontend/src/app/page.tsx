import AgentTrace from "@/components/landing/AgentTrace";
import { Nav, SideIndex } from "@/components/landing/Chrome";
import EngineSection from "@/components/landing/EngineSection";
import Footer from "@/components/landing/Footer";
import HackathonLog from "@/components/landing/HackathonLog";
import Hero from "@/components/landing/Hero";
import Loader from "@/components/landing/Loader";
import LoopStory from "@/components/landing/LoopStory";
import MetaStack from "@/components/landing/MetaStack";
import Pricing from "@/components/landing/Pricing";
import RoboStyles from "@/components/landing/RoboStyles";
import Systems from "@/components/landing/Systems";

export default function Home() {
  return (
    <div className="min-h-dvh bg-void text-fg">
      <Loader />
      <Nav />
      <SideIndex />
      <main>
        <Hero />
        <RoboStyles />
        <MetaStack />
        <LoopStory />
        <AgentTrace />
        <EngineSection />
        <Systems />
        <Pricing />
        <HackathonLog />
      </main>
      <Footer />
    </div>
  );
}
