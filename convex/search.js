import { query } from "./_generated/server";
import { v } from "convex/values";

// Search events by title or city
export const searchEvents = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.query || args.query.trim().length < 2) {
      return [];
    }

    const now = Date.now();
    const queryLower = args.query.trim().toLowerCase();
    const limit = args.limit ?? 5;

    // Search by title using search index
    const titleResults = await ctx.db
      .query("events")
      .withSearchIndex("search_title", (q) => q.search("title", args.query))
      .filter((q) => q.gte(q.field("startDate"), now))
      .take(limit);

    // Also search by city name (case-insensitive partial match)
    // Collect a larger set to ensure Delhi/NCR events are found
    const recentEvents = await ctx.db
      .query("events")
      .withIndex("by_start_date")
      .order("desc")
      .filter((q) => q.gte(q.field("startDate"), now))
      .take(200);

    const cityResults = recentEvents.filter(
      (e) =>
        e.city &&
        e.city.toLowerCase().includes(queryLower) &&
        !titleResults.some((t) => t._id === e._id)
    );

    // Combine: title matches first, then city matches
    const allResults = [...titleResults, ...cityResults];

    return allResults.slice(0, limit);
  },
});
