"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWebRTCContext } from "@/components/webrtc-provider";

interface LayerSelectorProps {
  trackId: string;
  availableLayers: string[];
  currentLayer?: string;
}

export function LayerSelector({ trackId, availableLayers, currentLayer }: LayerSelectorProps) {
  const { switchLayer } = useWebRTCContext();

  if (availableLayers.length <= 1) return null;

  const getLayerLabel = (layer: string) => {
    switch (layer) {
      case "h": return "High";
      case "m": return "Medium";
      case "l": return "Low";
      default: return layer;
    }
  };

  const handleLayerChange = (newLayer: string) => {
    switchLayer(trackId, newLayer);
  };

  return (
    <Select value={currentLayer} onValueChange={handleLayerChange}>
      <SelectTrigger className="w-20 h-6 text-xs bg-zinc-800/80 border-zinc-600 text-zinc-200">
        <SelectValue placeholder="Quality" />
      </SelectTrigger>
      <SelectContent className="bg-zinc-800 border-zinc-600">
        {availableLayers.map((layer) => (
          <SelectItem 
            key={layer} 
            value={layer}
            className="text-xs text-zinc-200 focus:bg-zinc-700"
          >
            {getLayerLabel(layer)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}