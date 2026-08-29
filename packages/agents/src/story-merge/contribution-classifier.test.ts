import { describe, expect, it } from "vitest";
import { classifyMatchContribution } from "./contribution-classifier";

describe("classifyMatchContribution", () => {
  it("classifies an identical second-source headline as corroboration", () => {
    const title = "Arsenal agree deal to sign Player X";
    expect(classifyMatchContribution(title, title, [])).toBe("corroboration");
  });

  it("classifies the same claim with different wording as corroboration", () => {
    expect(
      classifyMatchContribution(
        "Arsenal reach agreement to sign Martin Zubimendi",
        "Arsenal agree deal to sign Martin Zubimendi",
        [],
      ),
    ).toBe("corroboration");
  });

  it("classifies a newly reported transfer amount as new_info", () => {
    expect(
      classifyMatchContribution(
        "Arsenal agree £50m deal to sign Martin Zubimendi",
        "Arsenal agree deal to sign Martin Zubimendi",
        [],
      ),
    ).toBe("new_info");
  });

  it("classifies a newly reported medical status as new_info", () => {
    expect(
      classifyMatchContribution(
        "Arsenal agree deal, medical for Martin Zubimendi",
        "Arsenal agree deal to sign Martin Zubimendi",
        [],
      ),
    ).toBe("new_info");
  });

  it("classifies an uncertain, weakly similar headline as new_info", () => {
    expect(
      classifyMatchContribution(
        "Arsenal monitor another summer target",
        "Arsenal agree deal to sign Martin Zubimendi",
        [],
      ),
    ).toBe("new_info");
  });
});
