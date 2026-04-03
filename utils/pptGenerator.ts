
import pptxgen from "pptxgenjs";
import { PPTSlide } from "../types";

export const exportToPPTX = async (slides: PPTSlide[], title: string) => {
  const pres = new pptxgen();

  // Set Metadata
  pres.title = title;
  pres.subject = "NGO Project Report";
  pres.layout = "LAYOUT_16x9";

  // Master Slide Definition (Simple clean NGO theme)
  pres.defineSlideMaster({
    title: "MASTER_SLIDE",
    background: { color: "F3F4F6" }, // Light gray background
    objects: [
      {
        rect: { x: 0, y: 0, w: "100%", h: 0.8, fill: { color: "028090" } }, // NGO Teal top bar
      },
      {
        text: {
          text: title,
          options: { x: 0.5, y: 0.15, w: "90%", fontSize: 14, color: "FFFFFF", bold: true, align: "left" },
        },
      },
      {
        text: {
          text: "NGO Planner Generated",
          options: { x: 0.5, y: 7.2, w: "90%", fontSize: 10, color: "9CA3AF", align: "right" },
        },
      },
    ],
  });

  // Generate Slides
  slides.forEach((slide) => {
    const slideObj = pres.addSlide({ masterName: "MASTER_SLIDE" });

    // Title
    slideObj.addText(slide.title, {
      x: 0.5,
      y: 1.0,
      w: "90%",
      h: 0.8,
      fontSize: 24,
      bold: true,
      color: "111827", // Gray-900
      breakLine: false,
    });

    // Content (Bullets)
    if (slide.content && slide.content.length > 0) {
      const bulletItems = slide.content.map(item => ({ text: item, options: { fontSize: 16, breakLine: true } }));
      slideObj.addText(bulletItems, {
        x: 0.5,
        y: 2.0,
        w: "60%", // Leave room for visual notes or future images
        h: 4.5,
        color: "374151", // Gray-700
        bullet: { type: "number" },
        lineSpacing: 32,
      });
    }

    // Visual Suggestion Box (Placeholder for images)
    if (slide.visualSuggestion) {
      slideObj.addText("视觉建议:\n" + slide.visualSuggestion, {
        x: 7.0,
        y: 2.0,
        w: "25%",
        h: 4.0,
        fontSize: 10,
        color: "059669", // Green-600
        fill: { color: "ECFDF5" }, // Green-50
        align: "center",
        valign: "middle",
        rectRadius: 0.2
      });
    }

    // Speaker Notes
    if (slide.speakerNotes) {
      slideObj.addNotes(slide.speakerNotes);
    }
  });

  // Export
  return pres.writeFile({ fileName: `${title}.pptx` });
};
