import {
  createAttributesResource,
  type AttributesResource,
} from '../../../../../core/resources/interop/attributes/resource';
import { createViemAttributesAbiCodec } from './codec';

export function createViemAttributesResource(): AttributesResource {
  const codec = createViemAttributesAbiCodec();
  return createAttributesResource(codec);
}
