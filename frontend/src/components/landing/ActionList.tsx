import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Action } from "./types";

interface ActionListProps {
  actions: Action[];
  robotModel: string;
}

const ActionList: React.FC<ActionListProps> = ({ actions, robotModel }) => {
  const isLeKiwi = robotModel === "LeKiwi";
  const isDisabled = !robotModel || isLeKiwi;

  return (
    <TooltipProvider>
      <div className="pt-6">
        {!robotModel && (
          <p className="text-center text-gray-400 mb-4">
            Please select a robot model to continue.
          </p>
        )}
        {isLeKiwi && (
          <p className="text-center text-yellow-500 mb-4">
            LeKiwi model is not yet supported. Please select another model to
            continue.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {actions.map((action, index) => (
            <div
              key={index}
              className={`flex items-center justify-between p-4 bg-gray-800 rounded-lg border border-gray-700 transition-opacity ${
                isDisabled ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-lg text-left">
                      {action.title}
                    </h3>
                    {action.isWorkInProgress && (
                      <div className="flex items-center gap-1">
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Work in progress</p>
                          </TooltipContent>
                        </Tooltip>
                        <span className="text-yellow-500 text-xs font-medium">
                          Work in Progress
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm text-left">
                    {action.description}
                  </p>
                </div>
              </div>
              <Button
                onClick={action.handler}
                size="icon"
                className={`${action.color} text-white`}
                disabled={isDisabled}
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
};

export default ActionList;
