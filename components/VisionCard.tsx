/**
 * "Here's what we're building": an animated sketch of the client's future
 * product with their name on it, and the road from today to launch. Pure CSS
 * animation, so it renders instantly and calms down for reduced motion.
 */
export function VisionCard({
  companyName,
  projectName,
  kindLabel,
  steps,
}: {
  companyName: string;
  projectName: string;
  kindLabel: string;
  steps: string[];
}) {
  return (
    <div className="vision" aria-label={`A sketch of ${projectName}`}>
      <div className="vision-window" aria-hidden="true">
        <div className="vision-chrome">
          <span />
          <span />
          <span />
          <p>{companyName.toLowerCase().replace(/[^a-z0-9]+/g, "") || "yourcompany"}.com</p>
        </div>
        <div className="vision-body">
          <div className="vision-side">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="vision-content">
            <p className="vision-kicker">{kindLabel}</p>
            <p className="vision-name">{projectName}</p>
            <div className="vision-stats">
              <span>
                <b />
              </span>
              <span>
                <b />
              </span>
              <span>
                <b />
              </span>
            </div>
            <svg className="vision-chart" viewBox="0 0 240 70" preserveAspectRatio="none">
              <path className="vision-area" d="M0,62 C30,58 45,48 70,46 C100,44 110,30 140,28 C170,26 190,14 240,6 L240,70 L0,70 Z" />
              <path className="vision-line" d="M0,62 C30,58 45,48 70,46 C100,44 110,30 140,28 C170,26 190,14 240,6" />
            </svg>
          </div>
        </div>
      </div>
      <ol className="vision-road">
        {steps.map((s, i) => (
          <li key={s} style={{ animationDelay: `${600 + i * 180}ms` }}>
            <span className="road-dot" />
            <span className="road-label">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
