import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { KnowledgeType, SourceKind } from '@/features/relay/types';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export const KNOWLEDGE_META: Record<KnowledgeType, { label: string; icon: IconName }> = {
  responsibility: { label: 'Responsibility', icon: 'clipboard-check-outline' },
  deadline: { label: 'Deadline', icon: 'calendar-clock-outline' },
  contact: { label: 'Contact', icon: 'account-box-outline' },
  process: { label: 'Process', icon: 'format-list-numbered' },
  warning: { label: 'Warning', icon: 'alert-outline' },
  resource: { label: 'Resource', icon: 'link-variant' },
  lesson: { label: 'Lesson', icon: 'lightbulb-on-outline' },
};

export const SOURCE_META: Record<SourceKind, { label: string; icon: IconName }> = {
  typed_text: { label: 'Typed notes', icon: 'text-box-outline' },
  voice: { label: 'Voice recording', icon: 'microphone-outline' },
  document: { label: 'Document', icon: 'file-document-outline' },
};
