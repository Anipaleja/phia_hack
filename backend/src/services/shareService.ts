import { randomUUID } from "crypto";
import { OutfitResponse, SharedOutfit } from "../types";

class ShareService {
  private readonly sharedOutfits = new Map<string, SharedOutfit>();
  private readonly promptToShareId = new Map<string, string>();

  createShare(outfit: OutfitResponse): SharedOutfit {
    const id = randomUUID();
    const payload: SharedOutfit = {
      id,
      outfit: {
        ...outfit,
        shareId: id,
      },
      createdAt: Date.now(),
    };

    this.sharedOutfits.set(id, payload);

    if (outfit.prompt) {
      this.promptToShareId.set(outfit.prompt.toLowerCase(), id);
    }

    return payload;
  }

  getSharedOutfit(id: string): SharedOutfit | null {
    return this.sharedOutfits.get(id) || null;
  }

  getShareByPrompt(prompt: string): SharedOutfit | null {
    const id = this.promptToShareId.get(prompt.toLowerCase());
    if (!id) {
      return null;
    }
    return this.getSharedOutfit(id);
  }

  preGenerateShareForPopularPrompt(prompt: string, outfit: OutfitResponse, threshold: number): string | null {
    if (this.getShareByPrompt(prompt)) {
      return this.getShareByPrompt(prompt)?.id || null;
    }

    if (threshold < 3) {
      return null;
    }

    return this.createShare(outfit).id;
  }
}

export default new ShareService();
