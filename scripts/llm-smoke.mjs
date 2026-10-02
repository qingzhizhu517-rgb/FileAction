import { loadConfig } from '../src/config.js';
import { parseDocument } from '../src/document.js';
import { createModelClient } from '../src/model.js';

const config = loadConfig(process.env);
if (!config.llm.configured) {
  console.error('not_configured: LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL are required');
  process.exit(1);
}

const document = parseDocument({
  filename: 'synthetic-llm-smoke.txt',
  mediaType: 'text/plain',
  text: '合成样例：申请截止日期为 10 月 12 日。\n合成样例：需分别核对成绩与综合测评。',
});

try {
  const client = createModelClient(config.llm);
  const interpretation = await client.interpret({
    document,
    background: [{ id: 'bg-1', content: '合成背景：正在了解该申请。' }],
    previousAnswers: [],
  });
  console.log(`status=ok model=${config.llm.model} findings=${interpretation.findings.length} unknowns=${interpretation.unknowns.length}`);
} catch (error) {
  console.error(`${error.code ?? 'error'}: ${error.message}`);
  process.exit(1);
}
