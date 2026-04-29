import React from 'react';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
interface RobotModelSelectorProps {
  robotModel: string;
  onValueChange: (model: string) => void;
}
const RobotModelSelector: React.FC<RobotModelSelectorProps> = ({
  robotModel,
  onValueChange
}) => {
  return <div className="flex items-center justify-center gap-6">
      <h2 className="font-semibold text-white text-xl whitespace-nowrap">
        Select Robot Model
      </h2>
      <RadioGroup value={robotModel} onValueChange={onValueChange} className="flex items-center gap-3">
        <div>
          <RadioGroupItem value="SO100" id="so100" className="sr-only" />
          <Label htmlFor="so100" className="flex items-center gap-2 px-3 py-2 rounded-full bg-gray-800 border border-gray-700 cursor-pointer transition-all hover:bg-gray-750 min-w-[80px] justify-center">
            <span className="w-4 h-4 rounded-full border-2 border-gray-500 flex items-center justify-center">
              {robotModel === "SO100" && <span className="w-2 h-2 rounded-full bg-orange-500" />}
            </span>
            <span className="text-sm font-medium">SO100</span>
          </Label>
        </div>
        <div>
          <RadioGroupItem value="SO101" id="so101" className="sr-only" />
          <Label htmlFor="so101" className="flex items-center gap-2 px-3 py-2 rounded-full bg-gray-800 border border-gray-700 cursor-pointer transition-all hover:bg-gray-750 min-w-[80px] justify-center">
            <span className="w-4 h-4 rounded-full border-2 border-gray-500 flex items-center justify-center">
              {robotModel === "SO101" && <span className="w-2 h-2 rounded-full bg-orange-500" />}
            </span>
            <span className="text-sm font-medium">SO101</span>
          </Label>
        </div>
        <div>
          <RadioGroupItem value="LeKiwi" id="lekiwi" className="sr-only" disabled />
          <Label htmlFor="lekiwi" className="flex items-center gap-2 rounded-full bg-gray-800 border border-gray-700 cursor-not-allowed opacity-50 transition-all min-w-[80px] justify-center px-[20px] py-[6px]">
            <span className="w-4 h-4 rounded-full border-2 border-gray-500 flex items-center justify-center">
              {robotModel === "LeKiwi" && <span className="w-2 h-2 rounded-full bg-orange-500" />}
            </span>
            <div className="flex flex-col items-center">
              <span className="text-sm font-medium">LeKiwi</span>
              <span className="text-xs text-gray-400">Not available</span>
            </div>
          </Label>
        </div>
      </RadioGroup>
    </div>;
};
export default RobotModelSelector;