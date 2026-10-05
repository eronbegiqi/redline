import { createRoot } from "react-dom/client"

function CtaButton({ label }) {
  return <button className="cta" id="cta">{label}</button>
}

function Hero() {
  return (
    <section className="hero">
      <h2 id="hero-title">Hero heading</h2>
      <CtaButton label="Get started" />
    </section>
  )
}

function Features({ items }) {
  return (
    <ul className="features">
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  )
}

function App() {
  return (
    <main style={{ width: 600, padding: 24, fontFamily: "system-ui" }}>
      <Hero />
      <Features items={["Fast", "Small", "Honest"]} />
    </main>
  )
}

createRoot(document.getElementById("root")).render(<App />)
