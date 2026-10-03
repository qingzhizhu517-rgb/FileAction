import type { QueryClient } from "@tanstack/react-query";

// 删除或更正成功后同步所有本次保存回执；再次保留是新的明确选择，不能重放已删除请求。
export function forgetRetainedMemory(
  cache: QueryClient,
  userId: string,
  memoryId: string,
) {
  for (const [key, entries] of cache.getQueriesData<Record<string, string>>({
    queryKey: [userId, "retained-facts"],
  })) {
    if (!entries) continue;
    const removed = Object.keys(entries).filter(
      (signature) => entries[signature] === memoryId,
    );
    if (!removed.length) continue;
    cache.setQueryData(
      key,
      Object.fromEntries(
        Object.entries(entries).filter(([, id]) => id !== memoryId),
      ),
    );
    const requestKey = [userId, "retain-request-keys", key[2]];
    cache.setQueryData<Record<string, string>>(requestKey, (old) => ({
      ...old,
      ...Object.fromEntries(
        removed.map((signature) => [signature, crypto.randomUUID()]),
      ),
    }));
  }
}
