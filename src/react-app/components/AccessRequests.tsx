import { useState, useEffect } from "react";
import { Card } from "@/react-app/components/ui/card";
import { Button } from "@/react-app/components/ui/button";
import { Check, X, Bell, Loader2 } from "lucide-react";

interface AccessRequest {
  id: number;
  group_id: number;
  group_name: string;
  user_email: string;
  created_at: string;
}

export function AccessRequests() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = async () => {
    try {
      const res = await fetch("/api/access-requests");
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch (err) {
      console.error("Failed to fetch requests:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    // Refresh every 30 seconds to catch new requests
    const interval = setInterval(fetchRequests, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (id: number, action: 'approve' | 'deny') => {
    try {
      const res = await fetch(`/api/access-requests/${id}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        setRequests(requests.filter(r => r.id !== id));
      }
    } catch (err) {
      console.error(`Failed to ${action} request:`, err);
    }
  };

  if (loading) return null;
  if (requests.length === 0) return null;

  return (
    <div className="mb-8 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-amber-500 fill-amber-500" />
        <h2 className="font-bold text-gray-800">Pending Access Requests</h2>
        <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
          {requests.length}
        </span>
      </div>
      
      <div className="grid gap-3">
        {requests.map((request) => (
          <Card key={request.id} className="p-4 bg-white border-amber-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  <span className="text-emerald-600 font-bold">{request.user_email}</span> wants to edit
                </p>
                <p className="text-xs text-gray-500">Group: <span className="font-semibold">{request.group_name}</span></p>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  size="sm" 
                  onClick={() => handleAction(request.id, 'approve')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-8"
                >
                  <Check className="w-4 h-4 mr-1" /> Approve
                </Button>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleAction(request.id, 'deny')}
                  className="text-gray-500 hover:text-red-600 border-gray-200 h-8"
                >
                  <X className="w-4 h-4 mr-1" /> Deny
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}