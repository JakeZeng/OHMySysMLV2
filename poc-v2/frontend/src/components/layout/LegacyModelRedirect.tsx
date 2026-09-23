/**
 * M12 旧 /models/:modelId 路由跳转：
 *
 *   旧 URL：/models/:modelId[?projectId=...]
 *   新 URL：/projects/:projectId （无 modelId 透传 — M12 删 Model）
 *
 * 旧 modelId 已无对应实体；M12 决定不保留 mapping，直接跳到工程页。
 */

import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export const LegacyModelRedirect: React.FC = () => {
  const { modelId } = useParams<{ modelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const projectId = searchParams.get('projectId');

  React.useEffect(() => {
    if (projectId) {
      navigate(`/projects/${projectId}`, { replace: true });
      return;
    }
    // 无 projectId 时直接跳 dashboard（用户大概率手抖）
    navigate('/', { replace: true });
  }, [projectId, navigate, modelId]);

  return (
    <div className="flex h-full items-center justify-center text-sm text-gray-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在跳转到工程页…
    </div>
  );
};