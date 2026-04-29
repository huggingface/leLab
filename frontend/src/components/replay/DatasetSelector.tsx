
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database } from 'lucide-react';

interface Dataset {
    id: string;
    name: string;
}

interface DatasetSelectorProps {
    datasets: Dataset[];
    selectedDataset: string | null;
    onSelectDataset: (id: string | null) => void;
}

const DatasetSelector: React.FC<DatasetSelectorProps> = ({ datasets, selectedDataset, onSelectDataset }) => {
    return (
        <Card className="bg-gray-900 border-gray-700">
            <CardHeader>
                <CardTitle className="flex items-center gap-3 text-white">
                    <Database className="w-5 h-5 text-purple-400" />
                    Select Dataset
                </CardTitle>
            </CardHeader>
            <CardContent>
                <Select onValueChange={(value) => onSelectDataset(value)} value={selectedDataset ?? ''}>
                    <SelectTrigger className="w-full bg-gray-800 border-gray-600 text-white">
                        <SelectValue placeholder="Choose a dataset to replay..." />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 text-white border-gray-600">
                        {datasets.map(dataset => (
                            <SelectItem key={dataset.id} value={dataset.id} className="focus:bg-gray-700">
                                {dataset.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </CardContent>
        </Card>
    );
};

export default DatasetSelector;
