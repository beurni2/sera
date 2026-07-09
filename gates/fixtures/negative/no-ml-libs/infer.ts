// NEGATIVE FIXTURE: server-side per-image inference import — the
// imaging-architecture gate MUST fail on this file. Never import this.
import { InferenceSession } from 'onnxruntime-node';
export async function classifyProductImage(model: string): Promise<InferenceSession> {
  return InferenceSession.create(model);
}
