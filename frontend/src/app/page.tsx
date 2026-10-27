import { Nav, SideIndex } from "@/components/landing/Chrome";
import EngineSection from "@/components/landing/EngineSection";
import Footer from "@/components/landing/Footer";
import Hero from "@/components/landing/Hero";
import Loader from "@/components/landing/Loader";
import LoopStory from "@/components/landing/LoopStory";
import Systems from "@/components/landing/Systems";

export default function Home() {
  return (
    <div className="min-h-dvh bg-void text-fg">
      <Loader />
      <Nav />
      <SideIndex />
      <main>
        <Hero />
        <LoopStory />
        <EngineSection />
        <Systems />
      </main>
      <Footer />
    </div>
  );
}
