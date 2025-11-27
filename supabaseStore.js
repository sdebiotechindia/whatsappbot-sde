import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

export class SupabaseStore {
  constructor(supabase, bucket = "whatsapp-sessions") {
    this.supabase = supabase;
    this.bucket = bucket;
    this.tmpDir = path.join(os.tmpdir(), "wa-sessions");

    // ensure tmp dir exists
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  // Check if a session exists
  async sessionExists({ session }) {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .list("", { search: `${session}.zip` });

    if (error) {
      console.error("❌ [SupabaseStore] sessionExists error:", error.message);
      return false;
    }

    return data && data.length > 0;
  }

  // Download + extract
  async extract({ session, path: extractPath }) {
    console.log("📥 [SupabaseStore] Extracting session:", session);

    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .download(`${session}.zip`);

    if (error || !data) {
      console.log("⚠️ [SupabaseStore] No session found");
      return null;
    }

    const buf = Buffer.from(await data.arrayBuffer());
    await fsp.writeFile(extractPath, buf);

    // --- Auto-clean old zips (KEEP ONLY LATEST 1) ---
    await this.cleanTmp();

    return extractPath;
  }

  // Save zip (DISABLED by design)
  async save({ session }) {
    return;
  }

  // Delete session
  async delete({ session }) {
    console.log("🗑️ [SupabaseStore] Deleting:", session);

    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([`${session}.zip`]);

    if (error) {
      console.error("❌ [SupabaseStore] Delete error:", error.message);
      throw error;
    }

    console.log("✅ [SupabaseStore] Deleted:", session);
  }

  /**
   * Cleans the temporary directory, keeping only the most recently modified file (the current session).
   */
  async cleanTmp() {
    try {
      const files = await fsp.readdir(this.tmpDir);
      // 🔥 CHANGE HERE: If more than 1 file exists, delete the older ones.
      if (files.length > 1) {
        const KEEP_COUNT = 1; 

        const stats = await Promise.all(
          files.map(async f => {
            const st = await fsp.stat(path.join(this.tmpDir, f));
            return { file: f, time: st.mtimeMs };
          })
        );
        
        // Sort by time (oldest first)
        stats.sort((a, b) => a.time - b.time);
        
        // Slice to delete all but the newest one
        const toDelete = stats.slice(0, files.length - KEEP_COUNT);
        
        for (const f of toDelete) {
          await fsp.unlink(path.join(this.tmpDir, f.file));
          console.log("🧹 [SupabaseStore] Removed old tmp:", f.file);
        }
      }
    } catch (err) {
      console.warn("⚠️ [SupabaseStore] cleanTmp failed:", err.message);
    }
  }
}