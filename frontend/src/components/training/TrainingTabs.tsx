
import React from 'react';
import { Button } from '@/components/ui/button';
import { Settings, Activity } from 'lucide-react';

type Tab = 'config' | 'monitoring';

interface TrainingTabsProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}

const TrainingTabs: React.FC<TrainingTabsProps> = ({ activeTab, setActiveTab }) => {
  return (
    <div className="flex gap-2 mb-6 border-b border-slate-700">
      <Button
        variant="ghost"
        onClick={() => setActiveTab("config")}
        className={`flex items-center gap-2 rounded-none px-4 py-3 text-sm font-semibold transition-colors ${
          activeTab === "config"
            ? "text-white border-b-2 border-white"
            : "text-slate-400 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Settings className="w-4 h-4" />
        Configuration
      </Button>
      <Button
        variant="ghost"
        onClick={() => setActiveTab("monitoring")}
        className={`flex items-center gap-2 rounded-none px-4 py-3 text-sm font-semibold transition-colors ${
          activeTab === "monitoring"
            ? "text-white border-b-2 border-white"
            : "text-slate-400 hover:bg-slate-800 hover:text-white"
        }`}
      >
        <Activity className="w-4 h-4" />
        Monitoring
      </Button>
    </div>
  );
};

export default TrainingTabs;
