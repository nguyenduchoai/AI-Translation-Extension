export function parseProviderChunk(provider, data, streaming = true) {
  if (data.error) throw new Error(data.error.message || `${provider}: API error`);
  if (provider === 'gemini') {
    const blocked = data.promptFeedback?.blockReason;
    if (blocked) throw new Error(`Gemini chặn yêu cầu (${blocked}).`);
    const candidate = data.candidates?.[0];
    checkFinishReason(candidate?.finishReason, 'STOP', provider);
    const usage = data.usageMetadata;
    return {
      text: (candidate?.content?.parts || []).filter(part => !part.thought).map(part => part.text || '').join(''),
      model: data.modelVersion,
      finished: candidate?.finishReason === 'STOP',
      tokens: usage ? {
        prompt: usage.promptTokenCount ?? 0,
        completion: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        total: usage.totalTokenCount ?? 0
      } : null
    };
  }
  const choice = data.choices?.[0];
  checkFinishReason(choice?.finish_reason, 'stop', provider);
  const content = streaming ? choice?.delta : choice?.message;
  if (content?.refusal) throw new Error('OpenAI từ chối xử lý nội dung này.');
  return {
    text: content?.content || '',
    model: data.model,
    finished: choice?.finish_reason === 'stop',
    tokens: data.usage ? {
      prompt: data.usage.prompt_tokens ?? 0,
      completion: data.usage.completion_tokens ?? 0,
      total: data.usage.total_tokens ?? 0
    } : null
  };
}

function checkFinishReason(reason, success, provider) {
  if (!reason || reason === success) return;
  if (reason === 'length' || reason === 'MAX_TOKENS') {
    throw new Error('Kết quả bị cắt do giới hạn token. Hãy chụp vùng nhỏ hơn và thử lại.');
  }
  throw new Error(`${provider}: Nội dung bị chặn hoặc xử lý chưa hoàn tất (${reason}).`);
}
