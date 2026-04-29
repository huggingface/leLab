
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';

const ReplayHeader = () => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4 text-3xl">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Logo />
        <h1 className="font-bold text-white text-2xl">
          Replay Dataset
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full bg-slate-500`}></div>
        <span className={`font-semibold text-gray-400`}>
          Idle
        </span>
      </div>
    </div>
  );
};

export default ReplayHeader;
