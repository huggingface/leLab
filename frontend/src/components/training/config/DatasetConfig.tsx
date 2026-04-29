
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Database } from 'lucide-react';
import { ConfigComponentProps } from '../types';

const DatasetConfig: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700">
            <Database className="w-5 h-5 text-sky-400" />
          </div>
          Dataset Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="dataset_repo_id" className="text-slate-300">
            Dataset Repository ID *
          </Label>
          <Input
            id="dataset_repo_id"
            value={config.dataset_repo_id}
            onChange={(e) =>
              updateConfig("dataset_repo_id", e.target.value)
            }
            placeholder="e.g., your-username/your-dataset"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
          <p className="text-xs text-slate-500 mt-1">
            HuggingFace Hub dataset repository ID
          </p>
        </div>

        <div>
          <Label htmlFor="dataset_revision" className="text-slate-300">
            Dataset Revision (optional)
          </Label>
          <Input
            id="dataset_revision"
            value={config.dataset_revision || ""}
            onChange={(e) =>
              updateConfig(
                "dataset_revision",
                e.target.value || undefined
              )
            }
            placeholder="main"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
          <p className="text-xs text-slate-500 mt-1">
            Git revision (branch, tag, or commit hash)
          </p>
        </div>

        <div>
          <Label htmlFor="dataset_root" className="text-slate-300">
            Dataset Root Directory (optional)
          </Label>
          <Input
            id="dataset_root"
            value={config.dataset_root || ""}
            onChange={(e) =>
              updateConfig("dataset_root", e.target.value || undefined)
            }
            placeholder="./data"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default DatasetConfig;
